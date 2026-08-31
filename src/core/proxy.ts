/**
 * proxy.ts — instant audio proxy (no HLS)
 * Inspired by sample ProxyOptions pattern — prefetch + HEAD + timeout + zero-copy
 */

export interface ProxyOptions {
  url: string;
  contentType: string;
}

const YT_AGENT = "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)";

type PrefetchEntry = { ts: number; body: ReadableStream | null };
const prefetched = new Map<string, PrefetchEntry>();
const PREFETCH_TTL = 10_000;

function vidKeyFromUrl(url: string): string {
  // last 30 chars as cheap key (unique enough for googlevideo id)
  return url.slice(-32);
}

export function prefetchStream(url: string, vid: string = vidKeyFromUrl(url)): void {
  const key = vid || vidKeyFromUrl(url);
  const existing = prefetched.get(key);
  if (existing && Date.now() - existing.ts < PREFETCH_TTL) return;
  // Prefetch 1MB for instant full load + seek
  fetch(url, {
    headers: { Range: "bytes=0-1048576", "User-Agent": YT_AGENT },
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => {
      if (r.ok || r.status === 206) {
        prefetched.set(key, { ts: Date.now(), body: r.body });
      }
    })
    .catch(() => {});
}

function consumePrefetch(vid: string): ReadableStream | null {
  const key = vid;
  const entry = prefetched.get(key);
  if (!entry) return null;
  prefetched.delete(key);
  if (Date.now() - entry.ts > PREFETCH_TTL) return null;
  return entry.body;
}

export function clearPrefetch(): number {
  const n = prefetched.size;
  prefetched.clear();
  return n;
}

/**
 * Instant proxy — single RTT, keep-alive, prefetch-aware
 * @param upstreamUrl googlevideo URL (from IOS resolver)
 * @param headers client request headers (for Range forwarding)
 * @param method optional original method (HEAD support)
 */
export async function proxyStream(
  upstreamUrl: string,
  headers: Headers,
  method: string = "GET",
): Promise<Response> {
  const vidKey = vidKeyFromUrl(upstreamUrl);
  let clientRange = headers.get("Range") ?? headers.get("range");
  // Normalize: bytes=0- (full) → 1MB chunk for instant load + seek (avoids 403 on long videos)
  if (clientRange === "bytes=0-") clientRange = "bytes=0-1048576";
  // Proactive 1MB for instant full load (was 100KB, too small for 45min audio)
  const range = clientRange ?? "bytes=0-1048576";

  // HEAD — instant, warm prefetch for next GET
  if (method === "HEAD") {
    const h = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": "audio/webm",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    // warm in background
    const warmed = consumePrefetch(vidKey);
    if (!warmed) {
      fetch(upstreamUrl, {
        headers: { Range: "bytes=0-0", "User-Agent": YT_AGENT },
        signal: AbortSignal.timeout(5000),
      })
        .then((r) => r.arrayBuffer())
        .catch(() => {});
    }
    return new Response(null, { status: 200, headers: h });
  }

  // Serve prefetched body instantly if available and no explicit Range
  const prefetchedBody = vidKey ? consumePrefetch(vidKey) : null;
  if (prefetchedBody && !clientRange) {
    const h = new Headers({
      "Accept-Ranges": "bytes",
      "Content-Type": "audio/webm",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
      "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
    });
    return new Response(prefetchedBody, { status: 200, headers: h });
  }

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
    let upstream: Response = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      keepalive: true,
      signal: AbortSignal.timeout(15000),
    } as any);

    // Single retry on 403 — try alternative Range (long videos need bounded, not open)
    if (!upstream.ok && upstream.status === 403) {
      const retryHeaders = new Headers(upstreamHeaders);
      // If 1MB fails, try 128KB or 100KB
      const altRange = range === "bytes=0-1048576" ? "bytes=0-131072" : "bytes=0-1048576";
      retryHeaders.set("Range", altRange);
      try {
        const retry = await fetch(upstreamUrl, {
          method: "GET",
          headers: retryHeaders,
          keepalive: true,
          signal: AbortSignal.timeout(15000),
        } as any);
        if (retry.ok || retry.status === 206) {
          upstream = retry;
        } else if (retry.status !== 403) {
          upstream = retry; // return non-403 error to caller
        }
        // else keep original 403 for outer handler
      } catch {}
    }

    if (!upstream.ok && upstream.status !== 206) {
      // Return 502 but include retry hint for saudio to refresh cache
      return new Response(JSON.stringify({ error: "upstream_stream_failed", status: upstream.status, retryable: upstream.status === 403 }), {
        status: 502,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const h = new Headers({ "Accept-Ranges": "bytes" });
    const passthrough = ["content-type", "content-length", "content-range", "etag", "cache-control"];
    for (const k of passthrough) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    if (!h.has("content-type")) h.set("Content-Type", "audio/webm");
    h.set("Cache-Control", "public, max-age=86400");
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Range");
    h.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch (e) {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
