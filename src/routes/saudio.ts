/**
 * saudio.ts - Handler for GET /saudio/:videoId
 * Stale-while-revalidate + single-flight: same-id stampedes share one fetch,
 * slightly-expired URLs still play instantly while a fresh one loads behind.
 */

import {
  getCachedStream,
  getStaleStream,
  setCachedStream,
  deleteCachedStream,
  incrementSaudioRequests,
} from "../core/cache";
import { resolver } from "../core/resolver";
import { proxyStream, prefetchStream } from "../core/proxy";
import { VIDEO_ID_RE } from "../core/extractor";
import { json, requireMethod } from "../core/http";
import { singleflight } from "../core/singleflight";

function resolveFresh(videoId: string): Promise<{ streamUrl: string; expiresAt: number } | null> {
  return singleflight(`audio:${videoId}`, () => resolver.resolveAudioOnly(videoId));
}

export async function handleSaudio(req: Request, videoId: string): Promise<Response> {
  const methodErr = requireMethod(req, ["GET", "HEAD"]);
  if (methodErr) return methodErr;
  incrementSaudioRequests();

  if (!videoId || !VIDEO_ID_RE.test(videoId)) return json({ error: "Invalid video ID" }, 400);

  const url = new URL(req.url);
  const wantsJson =
    url.searchParams.has("json") ||
    url.searchParams.has("url") ||
    req.headers.get("Accept")?.includes("application/json");
  const wantsRedirect = url.searchParams.has("redirect");

  const cached = getCachedStream(videoId);
  let streamUrl: string;
  let expiresAt: number;
  let fromCache = true;

  if (cached) {
    streamUrl = cached.streamUrl;
    expiresAt = cached.expiresAt;
  } else {
    const stale = getStaleStream(videoId);
    if (stale) {
      // Instant playback on stale URL; refresh behind the scenes.
      streamUrl = stale.streamUrl;
      expiresAt = stale.expiresAt;
      resolveFresh(videoId)
        .then((fresh) => {
          if (fresh && fresh.streamUrl !== stale.streamUrl) {
            setCachedStream(videoId, fresh.streamUrl, fresh.expiresAt);
            try {
              prefetchStream(fresh.streamUrl, videoId);
            } catch {
              /* ignore */
            }
          }
        })
        .catch(() => {});
    } else {
      const resolved = await resolveFresh(videoId);
      if (!resolved) return json({ error: `Failed to resolve audio stream for: ${videoId}` }, 502);
      streamUrl = resolved.streamUrl;
      expiresAt = resolved.expiresAt;
      setCachedStream(videoId, streamUrl, expiresAt);
      fromCache = false;
    }
  }

  try {
    prefetchStream(streamUrl, videoId);
  } catch {
    /* ignore */
  }

  if (wantsJson) {
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    return json({
      videoId,
      streamUrl,
      proxyUrl: `${proto}://${host}/saudio/${videoId}`,
      expiresAt,
      expiresIn: Math.max(0, expiresAt - Math.floor(Date.now() / 1000)),
      cached: fromCache,
      note: "Use proxyUrl for instant <audio> playback; streamUrl needs Range header for long videos",
    });
  }
  if (wantsRedirect) return Response.redirect(streamUrl, 302);

  const res = await proxyStream(streamUrl, req.headers, req.method, videoId);

  // Retry once on 502 retryable (expired stream) with a fresh resolve.
  if (res.status === 502) {
    try {
      const body: any = await res.clone().json();
      if (body?.retryable) {
        deleteCachedStream(videoId);
        const fresh = await resolveFresh(videoId);
        if (fresh) {
          setCachedStream(videoId, fresh.streamUrl, fresh.expiresAt);
          try {
            prefetchStream(fresh.streamUrl, videoId);
          } catch {
            /* ignore */
          }
          return proxyStream(fresh.streamUrl, req.headers, req.method, videoId);
        }
      }
    } catch {
      /* fall through with original error */
    }
  }

  return res;
}
