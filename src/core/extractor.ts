/**
 * extractor.ts - URL/ID normalization & regex pattern matcher
 * Extracts a canonical 11-character videoId from messy user input.
 */

export type ExtractResult =
  | { ok: true; videoId: string }
  | { ok: false; error: string };

// Matches exactly 11 chars: alphanumeric, hyphens, underscores
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

// URL patterns mapped to capture group index for the video ID
const URL_PATTERNS: { re: RegExp; group: number }[] = [
  // youtube.com/watch?v=VIDEO_ID
  { re: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/, group: 1 },
  // youtu.be/VIDEO_ID
  { re: /(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})/, group: 1 },
  // youtube.com/shorts/VIDEO_ID
  { re: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/, group: 1 },
  // youtube.com/embed/VIDEO_ID
  { re: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{11})/, group: 1 },
  // music.youtube.com/watch?v=VIDEO_ID
  { re: /(?:https?:\/\/)?music\.youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/, group: 1 },
  // youtube.com/v/VIDEO_ID
  { re: /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([A-Za-z0-9_-]{11})/, group: 1 },
];

/**
 * Extract a canonical 11-character YouTube video ID from user input.
 * Accepts raw IDs, watch URLs, shorts, embeds, youtu.be, and YT Music links.
 */
export function extractVideoId(input: string): ExtractResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { ok: false, error: "Input is empty" };
  }

  // Direct raw ID
  if (VIDEO_ID_RE.test(trimmed)) {
    return { ok: true, videoId: trimmed };
  }

  // Try each URL pattern
  for (const { re, group } of URL_PATTERNS) {
    const match = trimmed.match(re);
    if (match?.[group]) {
      return { ok: true, videoId: match[group] };
    }
  }

  return {
    ok: false,
    error: `Could not extract a valid YouTube video ID from: ${trimmed}`,
  };
}
