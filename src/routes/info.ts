/**
 * info.ts - Handler for GET /info?q=<url|id>
 */

import { extractVideoId } from "../core/extractor";
import { getCachedMeta, setCachedMeta, getCachedStream, setCachedStream, incrementInfoRequests } from "../core/cache";
import { resolver } from "../core/resolver";
import { prefetchStream } from "../core/proxy";
import { buildStreamProxyUrl } from "../core/env";

export async function handleInfo(req: Request): Promise<Response> {
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
      if (cs) prefetchStream(cs.streamUrl, videoId);
      else {
        resolver.resolveAudioOnly(videoId).then((a) => {
          if (a) { setCachedStream(videoId, a.streamUrl, a.expiresAt); prefetchStream(a.streamUrl, videoId); }
        }).catch(() => {});
      }
    } catch {}
    try {
      const host = req.headers.get("host") ?? "localhost:3000";
      const proto = req.headers.get("x-forwarded-proto") ?? "http";
      fetch(`${proto}://${host}/saudio/${videoId}?json`).catch(() => {});
    } catch {}
    return json({ videoId: cached.videoId, title: cached.title, channel: cached.channel, duration: cached.duration, durationFormatted: cached.durationFormatted, thumbnail: cached.thumbnail, ytLink: cached.ytLink, streamUrl, proxyUrl, cached: true });
  }

  const resolved = await resolver.resolveTrack(videoId);
  if (!resolved) return json({ error: `Failed to resolve video: ${videoId}` }, 502);

  const { meta, audio } = resolved;
  setCachedMeta(meta);
  setCachedStream(videoId, audio.streamUrl, audio.expiresAt);
  try { prefetchStream(audio.streamUrl, videoId); } catch {}
  try {
    const host = req.headers.get("host") ?? "localhost:3000";
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    fetch(`${proto}://${host}/saudio/${videoId}?json`).catch(() => {});
  } catch {}

  return json({ videoId: meta.videoId, title: meta.title, channel: meta.channel, duration: meta.duration, durationFormatted: meta.durationFormatted, thumbnail: meta.thumbnail, ytLink: meta.ytLink, streamUrl, proxyUrl, cached: false });
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}
