/**
 * metadata.ts - Track metadata types
 */

export interface TrackInfo {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  durationFormatted: string;
  thumbnail: string;
  ytLink: string;
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
