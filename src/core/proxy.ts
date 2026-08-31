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
  upstreamHeaders.set("User-Agent", "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36");
  upstreamHeaders.set("Origin", "https://www.youtube.com");
  upstreamHeaders.set("Referer", "https://www.youtube.com/");

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: "GET",
      headers: upstreamHeaders,
    });

    if (!upstreamResponse.ok) {
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
