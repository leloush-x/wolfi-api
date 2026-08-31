/**
 * proxy.ts — smooth seek, dynamic load (YouTube Music style)
 * v2: windowed range chunking, fixed prefetch cache key, short-lived
 *     exact-range cache for scrub-back-and-forth, network-error retry.
 *
 * Public contract unchanged: same status codes, same headers exposed,
 * same call shape from routes/saudio.ts (plus one new optional arg).
 */

export interface ProxyOptions {
  url: string;
  contentType: string;
}

const YT_AGENT = "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)";

// ─── Chunk windowing ────────────────────────────────────────────
// Every proxied request is bounded to one of these windows instead of
// being forwarded as-is. This keeps each upstream fetch fast (so the
// per-request timeout below is never in danger of firing mid-stream)
// and turns "give me the rest of the file" into a sequence of quick
// chunk fetches the <audio> element naturally re-requests as it plays
// or seeks — the same technique Plex/Jellyfin-style proxies use.
const INITIAL_CHUNK = 512 * 1024;       // first byte: small, for instant start
const WINDOW_CHUNK = 4 * 1024 * 1024;   // rolling window during playback (~ a few min of audio)
const MAX_CLIENT_SPAN = 8 * 1024 * 1024; // hard cap on any client-specified range size

// ─── Prefetch cache (warms the first chunk while /info responds) ──
const prefetched = new Map<string, { ts: number; body: ReadableStream | null }>();
const PREFETCH_TTL = 10_000;

// ─── Short-lived exact-range cache ─────────────────────────────
// Handles rapid back-and-forth scrubbing: if the same byte range is
// requested again within a couple seconds, serve it from memory
// instead of re-hitting googlevideo. Bounded size + TTL keep memory
// use small — chunks are already windowed above, so nothing here
// can grow past WINDOW_CHUNK bytes per entry.
interface RangeEntry { ts: number; status: number; headers: Record<string, string>; body: ArrayBuffer; }
const rangeCache = new Map<string, RangeEntry>();
const RANGE_CACHE_TTL = 8_000;
const RANGE_CACHE_MAX = 12;

function rangeCacheKey(id: string, range: string): string {
  return `${id}::${range}`;
}

function pruneRangeCache(): void {
  if (rangeCache.size <= RANGE_CACHE_MAX) return;
  const oldestKey = [...rangeCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0]?.[0];
  if (oldestKey) rangeCache.delete(oldestKey);
}

function vidKey(url: string): string {
  return url.slice(-32);
}

export function prefetchStream(url: string, videoId: string): void {
  const key = videoId || vidKey(url);
  const e = prefetched.get(key);
  if (e && Date.now() - e.ts < PREFETCH_TTL) return;
  fetch(url, {
    headers: { Range: `bytes=0-${INITIAL_CHUNK}`, "User-Agent": YT_AGENT },
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => {
      if (r.ok || r.status === 206) prefetched.set(key, { ts: Date.now(), body: r.body });
    })
    .catch(() => {});
}

function consumePrefetch(key: string): ReadableStream | null {
  const e = prefetched.get(key);
  if (!e) return null;
  prefetched.delete(key);
  if (Date.now() - e.ts > PREFETCH_TTL) return null;
  return e.body;
}

export function clearPrefetch(): number {
  const n = prefetched.size;
  prefetched.clear();
  return n;
}

/** Parse an incoming Range header into a bounded {start,end} window. */
function resolveWindow(clientRange: string | null): { start: number; end: number; label: string } {
  if (!clientRange) {
    return { start: 0, end: INITIAL_CHUNK, label: `bytes=0-${INITIAL_CHUNK}` };
  }

  const m = /^bytes=(\d+)-(\d*)$/i.exec(clientRange.trim());
  if (!m) {
    // Unrecognized form (e.g. suffix range "bytes=-500") — forward untouched,
    // these are rare and not worth the complexity of windowing.
    return { start: -1, end: -1, label: clientRange };
  }

  const start = parseInt(m[1], 10);
  const explicitEnd = m[2] ? parseInt(m[2], 10) : null;

  let end: number;
  if (explicitEnd !== null) {
    // Client gave an explicit end — honor it, but cap the span.
    end = Math.min(explicitEnd, start + MAX_CLIENT_SPAN);
  } else {
    // Open-ended "rest of file" request — this is the case that used to
    // trigger a slow, timeout-prone multi-MB transfer. Bound it to a window;
    // the player will simply ask again for the next window as it advances.
    end = start + WINDOW_CHUNK;
  }

  return { start, end, label: `bytes=${start}-${end}` };
}

export async function proxyStream(
  upstreamUrl: string,
  headers: Headers,
  method: string = "GET",
  videoId?: string
): Promise<Response> {
  const cacheKey = videoId || vidKey(upstreamUrl);
  const clientRangeRaw = headers.get("Range") ?? headers.get("range");

  // HEAD — instant, no body, warm prefetch
  if (method === "HEAD") {
    const h = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": "audio/webm",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    if (!prefetched.get(cacheKey)) {
      fetch(upstreamUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": YT_AGENT },
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => r.arrayBuffer())
        .catch(() => {});
    }
    return new Response(null, { status: 200, headers: h });
  }

  const { start, end, label } = resolveWindow(clientRangeRaw);

  // Serve prefetched chunk instantly for a true first load (no Range at all)
  if (!clientRangeRaw) {
    const pre = consumePrefetch(cacheKey);
    if (pre) {
      const h = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Type": "audio/webm",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      });
      return new Response(pre, { status: 200, headers: h });
    }
  }

  // Short-lived exact-range cache — smooths rapid scrub-back-and-forth
  const rKey = rangeCacheKey(cacheKey, label);
  const cachedRange = rangeCache.get(rKey);
  if (cachedRange && Date.now() - cachedRange.ts < RANGE_CACHE_TTL) {
    const h = new Headers(cachedRange.headers);
    h.set("Access-Control-Allow-Origin", "*");
    return new Response(cachedRange.body.slice(0), { status: cachedRange.status, headers: h });
  }

  const upstreamHeaders = new Headers({
    Range: label,
    "User-Agent": YT_AGENT,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    Connection: "keep-alive",
    "Accept-Encoding": "identity",
  });
  const accept = headers.get("Accept");
  if (accept) upstreamHeaders.set("Accept", accept);

  const doFetch = (rangeHeader: string) => {
    const rh = new Headers(upstreamHeaders);
    rh.set("Range", rangeHeader);
    // Chunks are now bounded (max ~ WINDOW_CHUNK/MAX_CLIENT_SPAN), so a fixed
    // timeout is safe here — it covers a small, fast transfer rather than
    // however long the rest of the file takes to send.
    return fetch(upstreamUrl, {
      method: "GET",
      headers: rh,
      keepalive: true,
      signal: AbortSignal.timeout(15000),
    } as any);
  };

  try {
    let upstream: Response;
    try {
      upstream = await doFetch(label);
    } catch {
      // One retry on network failure (dropped connection, transient DNS, etc.)
      // — previously only 403s got a retry, network errors went straight to 502.
      upstream = await doFetch(label);
    }

    // Single retry for 403 with a smaller bounded window (expired sig, edge hiccup)
    if (!upstream.ok && upstream.status === 403) {
      const altStart = start >= 0 ? start : 0;
      const alt = `bytes=${altStart}-${altStart + INITIAL_CHUNK}`;
      try {
        const retry = await doFetch(alt);
        if (retry.ok || retry.status === 206) upstream = retry;
      } catch {}
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: "upstream_stream_failed", status: upstream.status, retryable: upstream.status === 403 }), {
        status: 502,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
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

    // Windowed chunks are small enough to safely tee into the range cache
    // without risking memory bloat (bounded by MAX_CLIENT_SPAN/WINDOW_CHUNK).
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

    // Fallback: stream directly without buffering (span unknown or too large)
    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
