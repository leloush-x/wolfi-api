/**
 * info.ts - Handler for GET /info?q=<url|id>
 * Updated: Request counter, ADDRESS_URL support for stream proxy URL.
 */

import { extractVideoId } from "../core/extractor";
import { getCachedMeta, setCachedMeta, setCachedStream, incrementInfoRequests } from "../core/cache";
import { resolver } from "../core/resolver";
import { prefetchStream } from "../core/proxy";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function getEnvConfig(): Record<string, string> {
  const envPath = join(import.meta.dir, "../../.env");
  const env: Record<string, string> = {};
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return env;
}

export async function handleInfo(req: Request): Promise<Response> {
  incrementInfoRequests();

  const url = new URL(req.url);
  const query = url.searchParams.get("q");

  if (!query) {
    return json({ error: "Missing query parameter ?q=" }, 400);
  }

  const result = extractVideoId(query);
  if (!result.ok) {
    return json({ error: result.error }, 400);
  }

  const { videoId } = result;

  const cached = getCachedMeta(videoId);
  if (cached) {
    const env = getEnvConfig();
    const addressUrl = env.ADDRESS_URL;
    let streamUrl = `/saudio/${videoId}`;
    if (addressUrl && addressUrl !== "localhost" && addressUrl !== "0.0.0.0") {
      streamUrl = `${addressUrl.replace(/\/$/, "")}/saudio/${videoId}`;
    }
    // Warm first chunk even for cached meta — makes /saudio instant
    try {
      const { getCachedStream } = await import("../core/cache");
      const cs = getCachedStream(videoId);
      if (cs) prefetchStream(cs.streamUrl, videoId);
      else {
        // No stream cached yet — resolve in background without blocking response
        resolver.resolveAudioOnly(videoId).then((a) => {
          if (a) {
            setCachedStream(videoId, a.streamUrl, a.expiresAt);
            prefetchStream(a.streamUrl, videoId);
          }
        }).catch(() => {});
      }
    } catch {}

    return json({
      videoId: cached.videoId,
      title: cached.title,
      channel: cached.channel,
      duration: cached.duration,
      durationFormatted: cached.durationFormatted,
      thumbnail: cached.thumbnail,
      ytLink: cached.ytLink,
      streamUrl,
      cached: true,
    });
  }

  const resolved = await resolver.resolveTrack(videoId);
  if (!resolved) {
    return json({ error: `Failed to resolve video: ${videoId}` }, 502);
  }

  const { meta, audio } = resolved;
  setCachedMeta(meta);
  // Cache stream + warm first chunk while /info responds — makes next /saudio instant (0.05s)
  setCachedStream(videoId, audio.streamUrl, audio.expiresAt);
  try { prefetchStream(audio.streamUrl, videoId); } catch {}

  const env = getEnvConfig();
  const addressUrl = env.ADDRESS_URL;
  let streamUrl = `/saudio/${videoId}`;
  if (addressUrl && addressUrl !== "localhost" && addressUrl !== "0.0.0.0") {
    streamUrl = `${addressUrl.replace(/\/$/, "")}/saudio/${videoId}`;
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
    cached: false,
  });
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
