/**
 * constants.ts — single source of truth.
 * All magic numbers, TTLs, headers, MIME types and paths live here.
 * Nothing else in src/ should redefine these.
 */

import { join } from "path";

const SRC_DIR = import.meta.dir;
const PROJECT_ROOT = join(SRC_DIR, "../..");

// ─── App ────────────────────────────────────────────────
export const APP_NAME = "Wolfie";
export const APP_VERSION = "2.0.0";

// ─── YouTube / InnerTube ────────────────────────────────
export const YT_AGENT =
  "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36";

export const MWEB_CLIENT = {
  clientName: "MWEB",
  clientVersion: "2.20240726.01.00",
  hl: "en",
  gl: "US",
  userAgent: YT_AGENT,
} as const;

// Max parallel InnerTube calls. YouTube 429s above this — queue the rest.
// Keeps throughput high without tripping bot checks.
export const YT_MAX_CONCURRENT = 4;
// Same videoId requested N times at once → 1 upstream fetch (thundering-herd guard).
export const SINGLEFLIGHT_TTL_MS = 30_000;

// ─── Cache TTLs (seconds unless noted) ──────────────────
export const META_TTL_S = 7 * 24 * 60 * 60; // 7 days — titles rarely change
export const STREAM_FIXED_TTL_S = 3 * 60 * 60; // 3h cap — YT expire param is authoritative
export const STREAM_SWR_S = 10 * 60; // serve stale up to 10min while revalidating
export const PREFETCH_TTL_MS = 10_000;
export const RANGE_CACHE_TTL_MS = 8_000;
export const RANGE_CACHE_MAX = 12;
export const PKG_LIST_TTL_MS = 30_000;

// ─── Proxy windowing (bytes) ────────────────────────────
export const INITIAL_CHUNK = 512 * 1024;
export const WINDOW_CHUNK = 4 * 1024 * 1024;
export const MAX_CLIENT_SPAN = 8 * 1024 * 1024;

// ─── Timeouts (ms) ──────────────────────────────────────
export const UPSTREAM_TIMEOUT_MS = 15_000;
export const PREFETCH_TIMEOUT_MS = 8_000;
export const HEAD_PROBE_TIMEOUT_MS = 5_000;
export const NPM_TIMEOUT_MS = 5_000;

// ─── Paths ──────────────────────────────────────────────
// NOTE: historic installs used a ".env." file (trailing dot). Support both.
export const ENV_PATHS = [
  join(PROJECT_ROOT, ".env"),
  join(PROJECT_ROOT, ".env."),
] as const;
export const COOKIE_PATH = join(PROJECT_ROOT, "cookies.txt");
export const DB_PATH = join(PROJECT_ROOT, "cache.sqlite");
export const WEB_DIST = join(PROJECT_ROOT, "dist/web");

// ─── CORS ───────────────────────────────────────────────
export const CORS_API = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Content-Type",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
} as const;

export const CORS_STREAM = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
} as const;

// ─── Static MIME ────────────────────────────────────────
export const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function mimeFor(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return MIME_TYPES[filename.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/** Hashed Vite assets (assets/index-ABC123.js) are safe to cache forever. */
export function isHashedAsset(pathname: string): boolean {
  return pathname.startsWith("/assets/");
}
