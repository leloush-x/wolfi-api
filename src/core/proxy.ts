/**
 * proxy.ts — ultra-fast byte proxy (instant load, no retry)
 * Single RTT, zero-copy streaming, keep-alive
 */

export async function proxyStream(upstreamUrl: string, headers: Headers): Promise<Response> {
  const range = headers.get("Range") ?? "bytes=0-99999";

  const upstreamHeaders = new Headers({
    Range: range,
    "User-Agent": "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)",
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    Connection: "keep-alive",
    "Accept-Encoding": "identity",
  });

  const accept = headers.get("Accept");
  if (accept) upstreamHeaders.set("Accept", accept);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
      keepalive: true,
    } as any);

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: `Upstream ${upstream.status}` }), {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const h = new Headers();
    h.set("Content-Type", upstream.headers.get("Content-Type") ?? "audio/webm");
    const cl = upstream.headers.get("Content-Length");
    const cr = upstream.headers.get("Content-Range");
    const ar = upstream.headers.get("Accept-Ranges");
    if (cl) h.set("Content-Length", cl);
    if (cr) h.set("Content-Range", cr);
    h.set("Accept-Ranges", ar ?? "bytes");
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Range");
    h.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    h.set("Cache-Control", "public, max-age=5");
    h.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: h,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Upstream fetch failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
