/**
 * metadata.ts - Track metadata parser
 * Normalizes Innertube response payloads into a clean, lightweight JSON structure.
 */

export interface TrackInfo {
  videoId: string;
  title: string;
  channel: string;
  duration: number; // seconds
  durationFormatted: string; // MM:SS or HH:MM:SS
  thumbnail: string; // best available URL
  ytLink: string; // canonical watch URL
}

/**
 * Format seconds into MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Extract the best thumbnail URL from Innertube's videoDetails.
 * Prefers the highest resolution available.
 */
function extractThumbnail(videoDetails: any): string {
  const thumbnails: any[] = videoDetails?.thumbnails ?? [];

  // Sort by resolution (width * height), pick largest
  const sorted = thumbnails
    .filter((t) => t.url)
    .sort((a: any, b: any) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));

  if (sorted.length > 0) {
    return sorted[0].url;
  }

  // Fallback to mqdefault
  return `https://i.ytimg.com/vi/${videoDetails?.videoId}/mqdefault.jpg`;
}

/**
 * Parse an Innertube /player response into a clean TrackInfo object.
 */
export function parsePlayerResponse(videoId: string, data: any): TrackInfo | null {
  try {
    const videoDetails = data?.videoDetails;
    if (!videoDetails) return null;

    const title: string = videoDetails.title ?? "Unknown Title";
    const author: string = videoDetails.author ?? videoDetails.channelId ?? "Unknown Artist";
    const lengthSeconds: number = parseInt(videoDetails.lengthSeconds ?? "0", 10);
    const thumbnail: string = extractThumbnail(videoDetails);

    return {
      videoId,
      title,
      channel: author,
      duration: lengthSeconds,
      durationFormatted: formatDuration(lengthSeconds),
      thumbnail,
      ytLink: `https://www.youtube.com/watch?v=${videoId}`,
    };
  } catch {
    return null;
  }
}
