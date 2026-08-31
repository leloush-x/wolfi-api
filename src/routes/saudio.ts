/**
 * saudio.ts - Handler for GET /saudio/:videoId
 * Updated: Request counter. v2: pass videoId through to proxyStream
 * so prefetch/range caching in proxy.ts actually key-matches.
 */

import { getCachedStream, setCachedStream, deleteCachedStream, incrementSaudioRequests } from "../core/cache";
import { resolver } from "../core/resolver";
import { proxyStream, prefetchStream } from "../core/proxy";

export async function handleSaudio(req: Request, videoId: string): Promise<Response> {
  incrementSaudioRequests();

  if (!videoId || videoId.length !== 11) {
    return json({ error: "Invalid video ID" }, 400);
  }

  const url = new URL(req.url);
  const wantsJson = url.searchParams.has("json") || url.searchParams.has("url") || req.headers.get("Accept")?.includes("application/json");
  const wantsRedirect = url.searchParams.has("redirect");

  const cached = getCachedStream(videoId);

  let streamUrl: string;
  let expiresAt: number;

  if (cached) {
    streamUrl = cached.streamUrl;
    expiresAt = cached.expiresAt;
  } else {
    const resolved = await resolver.resolveAudioOnly(videoId);
    if (!resolved) {
      return json({ error: `Failed to resolve audio stream for: ${videoId}` }, 502);
    }
    streamUrl = resolved.streamUrl;
    expiresAt = resolved.expiresAt;
    setCachedStream(videoId, streamUrl, expiresAt);
  }

  // Warm prefetch for next request — makes next GET instant via prefetchedBody
  // Fire-and-forget, non-blocking
  try {
    prefetchStream(streamUrl, videoId);
  } catch {}

  // Instant proxy URL (always works, single RTT, handles Range)
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const proxyUrl = `${proto}://${host}/saudio/${videoId}`;

  // Best audio stream URL only modes
  if (wantsJson) {
    return json({
      videoId,
      streamUrl, // direct googlevideo (needs Range: bytes=0-99999 for long videos, 403 otherwise)
      proxyUrl, // instant proxy (always 206, no 403, use this for <audio src>)
      expiresAt,
      expiresIn: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
      cached: !!cached,
      note: "Use proxyUrl for instant <audio> playback; streamUrl needs Range header for long videos",
    });
  }
  if (wantsRedirect) {
    return Response.redirect(streamUrl, 302);
  }

  // HEAD support + instant prefetch
  let res = await proxyStream(streamUrl, req.headers, req.method, videoId);

  // If upstream 403 (expire/sig), refresh cache once and retry
  if (res.status === 502) {
    try {
      const clone = res.clone();
      const body: any = await clone.json();
      if (body?.retryable) {
        deleteCachedStream(videoId);
        const fresh = await resolver.resolveAudioOnly(videoId);
        if (fresh) {
          setCachedStream(videoId, fresh.streamUrl, fresh.expiresAt);
          // re-prefetch fresh
          try { prefetchStream(fresh.streamUrl, videoId); } catch {}
          return proxyStream(fresh.streamUrl, req.headers, req.method, videoId);
        }
      }
    } catch {}
  }

  return res;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
