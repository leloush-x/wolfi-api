/**
 * info.ts - Handler for GET /info?q=<url|id>
 * Single-flight + stale-while-revalidate: concurrent same-id requests
 * share one upstream fetch; expired streams refresh in background.
 */

import { extractVideoId } from "../core/extractor";
import {
  getCachedMeta,
  setCachedMeta,
  getCachedStream,
  setCachedStream,
  incrementInfoRequests,
} from "../core/cache";
import { resolver } from "../core/resolver";
import { prefetchStream } from "../core/proxy";
import { buildStreamProxyUrl } from "../core/env";
import { json, requireMethod } from "../core/http";
import { singleflight } from "../core/singleflight";

function refreshStreamInBackground(videoId: string, knownUrl?: string): void {
  singleflight(`bg-audio:${videoId}`, async () => {
    try {
      const a = await resolver.resolveAudioOnly(videoId);
      if (a && a.streamUrl !== knownUrl) {
        setCachedStream(videoId, a.streamUrl, a.expiresAt);
        try {
          prefetchStream(a.streamUrl, videoId);
        } catch {
          /* ignore */
        }
      }
      return a;
    } catch {
      return null;
    }
  }).catch(() => {});
}

export async function handleInfo(req: Request): Promise<Response> {
  const methodErr = requireMethod(req, ["GET", "HEAD"]);
  if (methodErr) return methodErr;
  incrementInfoRequests();

  const url = new URL(req.url);
  const query = url.searchParams.get("q");
  if (!query) return json({ error: "Missing query parameter ?q=" }, 400);

  const result = extractVideoId(query);
  if (!result.ok) return json({ error: result.error }, 400);

  const { videoId } = result;
  const host = req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto");
  const { streamUrl, proxyUrl } = buildStreamProxyUrl(videoId, host, proto);

  const cached = getCachedMeta(videoId);
  if (cached) {
    try {
      const cs = getCachedStream(videoId);
      if (cs) {
        prefetchStream(cs.streamUrl, videoId);
      } else {
        // Cache hit on meta but stream expired → instant response + bg refresh.
        refreshStreamInBackground(videoId);
      }
    } catch {
      /* ignore */
    }
    return json({
      videoId: cached.videoId,
      title: cached.title,
      channel: cached.channel,
      duration: cached.duration,
      durationFormatted: cached.durationFormatted,
      thumbnail: cached.thumbnail,
      ytLink: cached.ytLink,
      streamUrl,
      proxyUrl,
      cached: true,
    });
  }

  // Miss → single-flight so N concurrent same-id requests = 1 YouTube call.
  const resolved = await singleflight(`track:${videoId}`, () => resolver.resolveTrack(videoId));
  if (!resolved) return json({ error: `Failed to resolve video: ${videoId}` }, 502);

  const { meta, audio } = resolved;
  setCachedMeta(meta);
  setCachedStream(videoId, audio.streamUrl, audio.expiresAt);
  try {
    prefetchStream(audio.streamUrl, videoId);
  } catch {
    /* ignore */
  }

  return json({
    videoId: meta.videoId,
    title: meta.title,
    channel: meta.channel,
    duration: meta.duration,
    durationFormatted: meta.durationFormatted,
    thumbnail: meta.thumbnail,
    ytLink: meta.ytLink,
    streamUrl,
    proxyUrl,
    cached: false,
  });
}
