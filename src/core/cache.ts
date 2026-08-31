/**
 * cache.ts - SQLite WAL client for TTL management & stream link persistence
 * Uses Bun's built-in bun:sqlite for high-speed caching.
 * Updated: Added request counters, cache toggle, cookie status tracking.
 */

import { Database } from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(import.meta.dir, "../../cache.sqlite");

// Default TTLs in seconds
const META_TTL = 7 * 24 * 60 * 60; // 7 days
const STREAM_SAFETY_BUFFER = 10 * 60; // 10 minutes before actual expiry

// ─── Cache Toggle ──────────────────────────────────────────────
let cacheEnabled = true;

export function isCacheEnabled(): boolean {
  return cacheEnabled;
}

export function setCacheEnabled(val: boolean): void {
  cacheEnabled = val;
}

// ─── Request Counters ──────────────────────────────────────────
let totalInfoRequests = 0;
let totalSaudioRequests = 0;
let totalApiRequests = 0;
const requestTimestamps: number[] = [];

export function incrementInfoRequests(): void {
  totalInfoRequests++;
  totalApiRequests++;
  requestTimestamps.push(Date.now());
  // Keep only last 1000 timestamps for rate calculation
  if (requestTimestamps.length > 1000) requestTimestamps.shift();
}

export function incrementSaudioRequests(): void {
  totalSaudioRequests++;
  totalApiRequests++;
  requestTimestamps.push(Date.now());
  if (requestTimestamps.length > 1000) requestTimestamps.shift();
}

export function getRequestStats() {
  const now = Date.now();
  const lastMinute = requestTimestamps.filter((t) => now - t < 60_000).length;
  const lastHour = requestTimestamps.filter((t) => now - t < 3_600_000).length;
  const requestsPerMin = lastMinute;
  const requestsPerHour = lastHour;

  return {
    total: totalApiRequests,
    info: totalInfoRequests,
    saudio: totalSaudioRequests,
    rate: {
      perMinute: requestsPerMin,
      perHour: requestsPerHour,
    },
  };
}

export interface CachedMeta {
  videoId: string;
  title: string;
  channel: string;
  duration: number;
  durationFormatted: string;
  thumbnail: string;
  ytLink: string;
  createdAt: number;
  expiresAt: number;
}

export interface CachedStream {
  videoId: string;
  streamUrl: string;
  createdAt: number;
  expiresAt: number;
}

// Hit/miss counters for /admin
let metaHits = 0;
let metaMisses = 0;
let streamHits = 0;
let streamMisses = 0;

const db = new Database(DB_PATH);

// Enable WAL mode for concurrent read/write
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (
    videoId TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    channel TEXT NOT NULL,
    duration INTEGER NOT NULL,
    durationFormatted TEXT NOT NULL,
    thumbnail TEXT NOT NULL,
    ytLink TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS streams (
    videoId TEXT PRIMARY KEY,
    streamUrl TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL
  );
`);

// Prepared statements
const insertMeta = db.prepare(`
  INSERT OR REPLACE INTO metadata (videoId, title, channel, duration, durationFormatted, thumbnail, ytLink, createdAt, expiresAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectMeta = db.prepare(`
  SELECT * FROM metadata WHERE videoId = ? AND expiresAt > ?
`);

const insertStream = db.prepare(`
  INSERT OR REPLACE INTO streams (videoId, streamUrl, createdAt, expiresAt)
  VALUES (?, ?, ?, ?)
`);

const selectStream = db.prepare(`
  SELECT * FROM streams WHERE videoId = ? AND expiresAt > ?
`);

const countMeta = db.prepare(`SELECT COUNT(*) as count FROM metadata`);
const countStreams = db.prepare(`SELECT COUNT(*) as count FROM streams`);
const countExpiredStreams = db.prepare(`SELECT COUNT(*) as count FROM streams WHERE expiresAt <= ?`);
const deleteAllMeta = db.prepare(`DELETE FROM metadata`);
const deleteAllStreams = db.prepare(`DELETE FROM streams`);
const deleteStream = db.prepare(`DELETE FROM streams WHERE videoId = ?`);

// ─── Metadata Cache ───────────────────────────────────────────

export function getCachedMeta(videoId: string): CachedMeta | null {
  if (!cacheEnabled) { metaMisses++; return null; }

  const now = Math.floor(Date.now() / 1000);
  const row = selectMeta.get(videoId, now) as any;
  if (row) {
    metaHits++;
    return {
      videoId: row.videoId,
      title: row.title,
      channel: row.channel,
      duration: row.duration,
      durationFormatted: row.durationFormatted,
      thumbnail: row.thumbnail,
      ytLink: row.ytLink,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
  metaMisses++;
  return null;
}

export function setCachedMeta(meta: Omit<CachedMeta, "createdAt" | "expiresAt">): void {
  if (!cacheEnabled) return;
  const now = Math.floor(Date.now() / 1000);
  insertMeta.run(
    meta.videoId, meta.title, meta.channel, meta.duration,
    meta.durationFormatted, meta.thumbnail, meta.ytLink,
    now, now + META_TTL
  );
}

// ─── Stream URL Cache ─────────────────────────────────────────

export function getCachedStream(videoId: string): CachedStream | null {
  if (!cacheEnabled) { streamMisses++; return null; }

  const now = Math.floor(Date.now() / 1000);
  const row = selectStream.get(videoId, now) as any;
  if (row) {
    streamHits++;
    return {
      videoId: row.videoId,
      streamUrl: row.streamUrl,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
  }
  streamMisses++;
  return null;
}

export function setCachedStream(videoId: string, streamUrl: string, expiresAt: number): void {
  if (!cacheEnabled) return;
  const now = Math.floor(Date.now() / 1000);
  const safeExpiry = expiresAt - STREAM_SAFETY_BUFFER;
  insertStream.run(videoId, streamUrl, now, safeExpiry);
}

export function parseExpiryFromUrl(url: string): number | null {
  try {
    const u = new URL(url);
    const expire = u.searchParams.get("expire");
    if (expire) return parseInt(expire, 10);
  } catch { }
  return null;
}

// ─── Admin / Stats ────────────────────────────────────────────

export function getCacheStats() {
  const now = Math.floor(Date.now() / 1000);
  const totalMeta = (countMeta.get() as any).count;
  const totalStreams = (countStreams.get() as any).count;
  const expiredStreams = (countExpiredStreams.get(now) as any).count;

  return {
    enabled: cacheEnabled,
    metadata: { total: totalMeta },
    streams: {
      total: totalStreams,
      active: totalStreams - expiredStreams,
      expired: expiredStreams,
    },
    hitRatios: {
      metadata: {
        hits: metaHits,
        misses: metaMisses,
        ratio: metaHits + metaMisses > 0
          ? `${((metaHits / (metaHits + metaMisses)) * 100).toFixed(1)}%`
          : "N/A",
      },
      streams: {
        hits: streamHits,
        misses: streamMisses,
        ratio: streamHits + streamMisses > 0
          ? `${((streamHits / (streamHits + streamMisses)) * 100).toFixed(1)}%`
          : "N/A",
      },
    },
  };
}

export function deleteCachedStream(videoId: string): void {
  deleteStream.run(videoId);
}

export function flushCache(): { metadata: number; streams: number } {
  const metaResult = deleteAllMeta.run();
  const streamResult = deleteAllStreams.run();
  metaHits = 0;
  metaMisses = 0;
  streamHits = 0;
  streamMisses = 0;
  return {
    metadata: metaResult.changes,
    streams: streamResult.changes,
  };
}

export function purgeExpiredStreams(): number {
  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`DELETE FROM streams WHERE expiresAt <= ?`).run(now);
  return result.changes;
}
