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
