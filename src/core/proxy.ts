/**
 * proxy.ts — smooth seek, dynamic load (YouTube Music style)
 * No heavy caching — forwards Range exactly, streams instantly
 */

export interface ProxyOptions {
  url: string;
  contentType: string;
}

const YT_AGENT = "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)";

// Light prefetch for instant first play (1MB)
const prefetched = new Map<string, { ts: number; body: ReadableStream | null }>();
const PREFETCH_TTL = 10_000;

function vidKey(url: string): string {
  return url.slice(-32);
}

export function prefetchStream(url: string, vid: string = vidKey(url)): void {
  const k = vid || vidKey(url);
  const e = prefetched.get(k);
  if (e && Date.now() - e.ts < PREFETCH_TTL) return;
  fetch(url, {
    headers: { Range: "bytes=0-1048576", "User-Agent": YT_AGENT },
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => {
      if (r.ok || r.status === 206) prefetched.set(k, { ts: Date.now(), body: r.body });
    })
    .catch(() => {});
}

function consumePrefetch(vid: string): ReadableStream | null {
  const e = prefetched.get(vid);
  if (!e) return null;
  prefetched.delete(vid);
  if (Date.now() - e.ts > PREFETCH_TTL) return null;
  return e.body;
}

export function clearPrefetch(): number {
  const n = prefetched.size;
  prefetched.clear();
  return n;
}

export async function proxyStream(upstreamUrl: string, headers: Headers, method: string = "GET"): Promise<Response> {
  const vid = vidKey(upstreamUrl);
  let clientRange = headers.get("Range") ?? headers.get("range");
  if (clientRange === "bytes=0-") clientRange = "bytes=0-1048576";
  const range = clientRange ?? "bytes=0-1048576";

  // HEAD — instant, no body, warm prefetch
  if (method === "HEAD") {
    const h = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": "audio/webm",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    if (!prefetched.get(vid)) {
      fetch(upstreamUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": YT_AGENT },
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => r.arrayBuffer())
        .catch(() => {});
    }
    return new Response(null, { status: 200, headers: h });
  }

  // Serve prefetched 1MB instantly for first load (no Range)
  const pre = !clientRange ? consumePrefetch(vid) : null;
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

  // Dynamic Range forwarding — seek forward/backward instantly
  const upstreamHeaders = new Headers({
    Range: range,
    "User-Agent": YT_AGENT,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    Connection: "keep-alive",
    "Accept-Encoding": "identity",
  });
  const accept = headers.get("Accept");
  if (accept) upstreamHeaders.set("Accept", accept);

  try {
    let upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      keepalive: true,
      signal: AbortSignal.timeout(15000),
    } as any);

    // Single retry for 403 with alternative bounded Range
    if (!upstream.ok && upstream.status === 403) {
      const alt = range === "bytes=0-1048576" ? "bytes=0-131072" : "bytes=0-1048576";
      const rh = new Headers(upstreamHeaders);
      rh.set("Range", alt);
      try {
        const retry = await fetch(upstreamUrl, { method: "GET", headers: rh, keepalive: true, signal: AbortSignal.timeout(15000) } as any);
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

    // Stream directly — no buffering, dynamic bar loads as browser requests Range
    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
