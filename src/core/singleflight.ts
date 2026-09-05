/**
 * singleflight.ts — anti-thundering-herd + concurrency guard.
 *
 * Problem it solves: 50 clients ask for the SAME videoId at the same moment
 * → without this, 50 parallel YouTube fetches → instant 429/bot-check.
 * With this, 1 upstream fetch happens and all 50 await the same promise.
 *
 * Also provides a tiny semaphore so total parallel YouTube calls stay capped
 * (high throughput, no rate-limit self-DDoS), and an exp-backoff retry helper.
 */

// ─── Single-flight ──────────────────────────────────────
const inflight = new Map<string, Promise<any>>();

export function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => {
    if (inflight.get(key) === p) inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export function inflightCount(): number {
  return inflight.size;
}

// ─── Semaphore (concurrency limiter) ────────────────────
export function createLimiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  let maxSeen = 0;

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((res) => queue.push(res));
    active++;
    if (active > maxSeen) maxSeen = active;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  }

  return {
    run,
    stats: () => ({ active, queued: queue.length, max, maxSeen }),
  };
}

// ─── Retry with exponential backoff + jitter ────────────
export async function retry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T> {
  const tries = opts.tries ?? 3;
  const baseMs = opts.baseMs ?? 400;
  const maxMs = opts.maxMs ?? 4_000;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === tries - 1) break;
      const wait = Math.min(maxMs, baseMs * 2 ** i) + Math.random() * 120;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}
