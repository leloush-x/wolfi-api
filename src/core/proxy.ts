/**
 * proxy.ts — smooth seek, dynamic load (YouTube Music style)
 * v3: cookies/constants centralized, retry with backoff, contract unchanged.
 *
 * Public contract unchanged: same status codes, same headers exposed,
 * same call shape from routes/saudio.ts.
 */

import {
  INITIAL_CHUNK,
  WINDOW_CHUNK,
  MAX_CLIENT_SPAN,
  PREFETCH_TTL_MS,
  RANGE_CACHE_TTL_MS,
  RANGE_CACHE_MAX,
  PREFETCH_TIMEOUT_MS,
  UPSTREAM_TIMEOUT_MS,
  HEAD_PROBE_TIMEOUT_MS,
  YT_AGENT,
} from "./constants";
import { getCookieHeader, getCookieVal, getSapisidHash } from "./cookies";

/** Build standard YT upstream headers (cookies + SAPISIDHASH + visitor ID). */
function buildUpstreamAuth(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": YT_AGENT, ...extra };
  const cookies = getCookieHeader();
  if (cookies) h["Cookie"] = cookies;
  const sh = getSapisidHash();
  if (sh) {
    h["Authorization"] = `SAPISIDHASH ${sh}`;
    h["X-Goog-AuthUser"] = "0";
  }
  const vis = getCookieVal("VISITOR_INFO1_LIVE");
  if (vis) h["X-Goog-Visitor-Id"] = vis;
  return h;
}

// ─── Prefetch cache ─────────────────────────────────────────
interface PrefetchEntry {
  ts: number;
  body: ReadableStream | null;
  status: number;
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
}
const prefetched = new Map<string, PrefetchEntry>();

// ─── Short-lived exact-range cache ──────────────────────────
interface RangeEntry {
  ts: number;
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
}
const rangeCache = new Map<string, RangeEntry>();

function rangeCacheKey(id: string, range: string): string {
  return `${id}::${range}`;
}

function pruneRangeCache(): void {
  if (rangeCache.size <= RANGE_CACHE_MAX) return;
  let oldestKey = "";
  let oldestTs = Infinity;
  for (const [k, v] of rangeCache) {
    if (v.ts < oldestTs) {
      oldestTs = v.ts;
      oldestKey = k;
    }
  }
  if (oldestKey) rangeCache.delete(oldestKey);
}

function pruneRangeExpired(): void {
  const now = Date.now();
  for (const [k, v] of rangeCache) {
    if (now - v.ts > RANGE_CACHE_TTL_MS) rangeCache.delete(k);
  }
}

function vidKey(url: string): string {
  return url.slice(-32);
}

export function prefetchStream(url: string, videoId: string): void {
  const key = videoId || vidKey(url);
  prunePrefetch();
  const e = prefetched.get(key);
  if (e && Date.now() - e.ts < PREFETCH_TTL_MS) return;
  const h = buildUpstreamAuth({ Range: `bytes=0-${INITIAL_CHUNK}` });
  fetch(url, { headers: h, signal: AbortSignal.timeout(PREFETCH_TIMEOUT_MS) })
    .then((r) => {
      if (r.ok || r.status === 206) {
        prefetched.set(key, {
          ts: Date.now(),
          body: r.body,
          status: r.status,
          contentType: r.headers.get("content-type"),
          contentLength: r.headers.get("content-length"),
          contentRange: r.headers.get("content-range"),
        });
      }
    })
    .catch(() => {});
}

function consumePrefetch(key: string): PrefetchEntry | null {
  const e = prefetched.get(key);
  if (!e) return null;
  prefetched.delete(key);
  if (Date.now() - e.ts > PREFETCH_TTL_MS) return null;
  return e;
}

function prunePrefetch(): void {
  const now = Date.now();
  for (const [k, v] of prefetched) {
    if (now - v.ts > PREFETCH_TTL_MS) prefetched.delete(k);
  }
}

export function clearPrefetch(): number {
  const n = prefetched.size;
  prefetched.clear();
  return n;
}

function resolveWindow(clientRange: string | null): { start: number; end: number; label: string } {
  if (!clientRange) {
    return { start: 0, end: INITIAL_CHUNK, label: `bytes=0-${INITIAL_CHUNK}` };
  }
  const m = /^bytes=(\d+)-(\d*)$/i.exec(clientRange.trim());
  if (!m) return { start: -1, end: -1, label: clientRange };
  const start = parseInt(m[1], 10);
  const explicitEnd = m[2] ? parseInt(m[2], 10) : null;
  const end =
    explicitEnd !== null
      ? Math.min(explicitEnd, start + MAX_CLIENT_SPAN)
      : start + WINDOW_CHUNK;
  return { start, end, label: `bytes=${start}-${end}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function proxyStream(
  upstreamUrl: string,
  headers: Headers,
  method = "GET",
  videoId?: string,
): Promise<Response> {
  const cacheKey = videoId || vidKey(upstreamUrl);
  const clientRangeRaw = headers.get("Range") ?? headers.get("range");

  // HEAD — instant, no body, warm prefetch
  if (method === "HEAD") {
    const existing = prefetched.get(cacheKey);
    const h = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    if (existing?.contentType) h.set("Content-Type", existing.contentType);
    if (!existing) {
      const hh = buildUpstreamAuth({ Range: "bytes=0-0" });
      fetch(upstreamUrl, { headers: hh, signal: AbortSignal.timeout(HEAD_PROBE_TIMEOUT_MS) })
        .then((r) => r.arrayBuffer())
        .catch(() => {});
    }
    return new Response(null, { status: 200, headers: h });
  }

  const { start, end: _end, label } = resolveWindow(clientRangeRaw);

  // Serve prefetched chunk instantly for a true first load (no Range)
  if (!clientRangeRaw) {
    const pre = consumePrefetch(cacheKey);
    if (pre) {
      const h = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Type": pre.contentType || "audio/webm",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      });
      if (pre.contentLength) h.set("Content-Length", pre.contentLength);
      if (pre.contentRange) h.set("Content-Range", pre.contentRange);
      return new Response(pre.body, { status: pre.status, headers: h });
    }
  }

  // Short-lived exact-range cache
  pruneRangeExpired();
  const rKey = rangeCacheKey(cacheKey, label);
  const cachedRange = rangeCache.get(rKey);
  if (cachedRange && Date.now() - cachedRange.ts < RANGE_CACHE_TTL_MS) {
    const h = new Headers(cachedRange.headers);
    h.set("Access-Control-Allow-Origin", "*");
    return new Response(cachedRange.body.slice(0), { status: cachedRange.status, headers: h });
  }

  const upstreamHeaders = buildUpstreamAuth({
    Range: label,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    Connection: "keep-alive",
    "Accept-Encoding": "identity",
  });
  const accept = headers.get("Accept");
  if (accept) upstreamHeaders["Accept"] = accept;

  const doFetch = (rangeHeader: string) => {
    const rh = { ...upstreamHeaders, Range: rangeHeader };
    return fetch(upstreamUrl, {
      method: "GET",
      headers: rh,
      keepalive: true,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    } as any);
  };

  try {
    let upstream: Response;
    try {
      upstream = await doFetch(label);
    } catch {
      // Single backoff retry — not a hot loop. Transient RST/timeout recovery.
      await sleep(350 + Math.random() * 250);
      upstream = await doFetch(label);
    }

    if (!upstream.ok && upstream.status === 403) {
      const altStart = start >= 0 ? start : 0;
      const alt = `bytes=${altStart}-${altStart + INITIAL_CHUNK}`;
      try {
        await sleep(300);
        const retryRes = await doFetch(alt);
        if (retryRes.ok || retryRes.status === 206) upstream = retryRes;
      } catch {
        /* keep original */
      }
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(
        JSON.stringify({
          error: "upstream_stream_failed",
          status: upstream.status,
          retryable: upstream.status === 403,
        }),
        {
          status: 502,
          headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
        },
      );
    }

    const h = new Headers({ "Accept-Ranges": "bytes" });
    for (const k of ["content-type", "content-length", "content-range", "etag", "cache-control"]) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    if (!h.has("content-type")) h.set("Content-Type", "audio/webm");
    h.set("Cache-Control", "public, max-age=86400");
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Range");
    h.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    const contentLength = parseInt(upstream.headers.get("content-length") ?? "", 10);
    const cacheable = upstream.body && !Number.isNaN(contentLength) && contentLength <= MAX_CLIENT_SPAN;

    if (cacheable) {
      const buf = await upstream.arrayBuffer();
      const headerObj: Record<string, string> = {};
      h.forEach((v, k) => (headerObj[k] = v));
      rangeCache.set(rKey, { ts: Date.now(), status: upstream.status, headers: headerObj, body: buf });
      pruneRangeCache();
      return new Response(buf, { status: upstream.status, headers: h });
    }

    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
