/**
 * proxy.ts - Byte streaming engine
 * Mediates byte delivery between googlevideo.com and the client.
 * Supports Range headers for seeking/scrubbing, streams without full buffering.
 */

/**
 * Stream audio bytes from an upstream URL to the client Response.
 * Forwards Range headers for seeking support and masks origin headers.
 */
export async function proxyStream(
  upstreamUrl: string,
  headers: Headers
): Promise<Response> {
  // Build upstream request headers
  const upstreamHeaders = new Headers();

  // Forward Range header for seeking/scrubbing support
  const range = headers.get("Range");
  if (range) {
    upstreamHeaders.set("Range", range);
  }

  // Forward other useful headers
  const accept = headers.get("Accept");
  if (accept) {
    upstreamHeaders.set("Accept", accept);
  }

  // Mask origin to prevent rate-limiting / IP mismatch blocks
  // Use IOS UA to match resolver's IOS client (required for IOS-generated googlevideo URLs)
  upstreamHeaders.set("User-Agent", "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)");
  upstreamHeaders.set("Origin", "https://www.youtube.com");
  upstreamHeaders.set("Referer", "https://www.youtube.com/");

  async function fetchUpstream(extraHeaders: Headers): Promise<Response> {
    return fetch(upstreamUrl, { method: "GET", headers: extraHeaders });
  }

  try {
    let upstreamResponse = await fetchUpstream(upstreamHeaders);

    // YouTube throttling: long videos require Range; also some Ranges get 403
    // Retry on any 403 - try alternative Range values
    if (upstreamResponse.status === 403) {
      console.warn(`[proxy] Got 403 (Range:${range ?? "none"}) retrying with bytes=0-99999 for ${upstreamUrl.slice(0,80)}...`);
      const retryHeaders = new Headers(upstreamHeaders);
      // Always use a bounded range for retry (0-999 fails, 0-99999 works per test)
      retryHeaders.set("Range", "bytes=0-99999");
      const retry = await fetchUpstream(retryHeaders);
      if (retry.ok || retry.status === 206) {
        console.log(`[proxy] Retry success: ${retry.status} for Range 0-99999 (orig Range:${range ?? "none"})`);
        upstreamResponse = retry;
      } else {
        console.warn(`[proxy] Retry 0-99999 failed: ${retry.status}, trying 0-999`);
        const retry2Headers = new Headers(upstreamHeaders);
        retry2Headers.set("Range", "bytes=0-999");
        const retry2 = await fetchUpstream(retry2Headers);
        if (retry2.ok || retry2.status === 206) {
          console.log(`[proxy] Retry2 success: ${retry2.status}`);
          upstreamResponse = retry2;
        } else {
          console.warn(`[proxy] Retry2 also failed: ${retry2.status} (orig Range:${range ?? "none"})`);
        }
      }
    }

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      // Try to get more detail from upstream body for debugging
      let detail = "";
      try { detail = await upstreamResponse.text(); } catch {}
      console.error(`[proxy] Upstream ${upstreamResponse.status} for ${upstreamUrl.slice(0,120)} detail=${detail.slice(0,200)}`);
      return new Response(
        JSON.stringify({ error: `Upstream returned ${upstreamResponse.status}` }),
        {
          status: upstreamResponse.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Build response headers
    const responseHeaders = new Headers();
    const contentType = upstreamResponse.headers.get("Content-Type") ?? "audio/mpeg";
    const contentLength = upstreamResponse.headers.get("Content-Length");
    const contentRange = upstreamResponse.headers.get("Content-Range");
    const acceptRanges = upstreamResponse.headers.get("Accept-Ranges");

    responseHeaders.set("Content-Type", contentType);

    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }

    if (contentRange) {
      responseHeaders.set("Content-Range", contentRange);
    }

    if (acceptRanges) {
      responseHeaders.set("Accept-Ranges", acceptRanges);
    } else {
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    // CORS headers for browser playback
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Range");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    // Stream the body directly - no buffering
    return new Response(upstreamResponse.body, {
      status: range ? 206 : upstreamResponse.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[proxy] Upstream fetch error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to fetch upstream audio" }),
      {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
