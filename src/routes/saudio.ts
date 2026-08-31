/**
 * saudio.ts - Handler for GET /saudio/:videoId
 */

import { getCachedStream, setCachedStream, deleteCachedStream, incrementSaudioRequests } from "../core/cache";
import { resolver } from "../core/resolver";
import { proxyStream, prefetchStream } from "../core/proxy";

async function retryOn502<T>(
  res: Response,
  videoId: string,
  headers: Headers | Record<string, string>,
  method: string,
  reProxy: (streamUrl: string) => Promise<T>
): Promise<{ res: Response; retried: boolean }> | Promise<T> {
  // This is a simplified version — saudio uses it inline below
  return { res, retried: false };
}

export async function handleSaudio(req: Request, videoId: string): Promise<Response> {
  incrementSaudioRequests();

  if (!videoId || videoId.length !== 11) return json({ error: "Invalid video ID" }, 400);

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
    if (!resolved) return json({ error: `Failed to resolve audio stream for: ${videoId}` }, 502);
    streamUrl = resolved.streamUrl;
    expiresAt = resolved.expiresAt;
    setCachedStream(videoId, streamUrl, expiresAt);
  }

  try { prefetchStream(streamUrl, videoId); } catch {}

  if (wantsJson) {
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    return json({
      videoId, streamUrl, proxyUrl: `${proto}://${host}/saudio/${videoId}`, expiresAt,
      expiresIn: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
      cached: !!cached, note: "Use proxyUrl for instant <audio> playback; streamUrl needs Range header for long videos",
    });
  }
  if (wantsRedirect) return Response.redirect(streamUrl, 302);

  let res = await proxyStream(streamUrl, req.headers, req.method, videoId);

  // Retry on 502 (expired stream)
  if (res.status === 502) {
    try {
      const body: any = await res.clone().json();
      if (body?.retryable) {
        deleteCachedStream(videoId);
        const fresh = await resolver.resolveAudioOnly(videoId);
        if (fresh) {
          setCachedStream(videoId, fresh.streamUrl, fresh.expiresAt);
          try { prefetchStream(fresh.streamUrl, videoId); } catch {}
          return proxyStream(fresh.streamUrl, req.headers, req.method, videoId);
        }
      }
    } catch {}
  }

  return res;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
