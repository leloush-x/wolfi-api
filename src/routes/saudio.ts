/**
 * saudio.ts - Handler for GET /saudio/:videoId
 * Updated: Request counter.
 */

import { getCachedStream, setCachedStream, parseExpiryFromUrl, incrementSaudioRequests } from "../core/cache";
import { resolver } from "../core/resolver";
import { proxyStream } from "../core/proxy";

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

  return proxyStream(streamUrl, req.headers);
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
