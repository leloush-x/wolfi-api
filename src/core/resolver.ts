/**
 * resolver.ts - Persistent MWEB Innertube session & audio stream resolver
 * Updated: Dynamic cookie reload, cookie status, latency tracking.
 */

import { parsePlayerResponse, type TrackInfo } from "./metadata";
import { parseExpiryFromUrl } from "./cache";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

// ─── MWEB Client Constants ────────────────────────────────────

const MWEB_CLIENT = {
  clientName: "MWEB",
  clientVersion: "2.20240726.01.00",
  hl: "en",
  gl: "US",
  userAgent:
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
};

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player";
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

// ─── Cookie Management ────────────────────────────────────────

let COOKIE_PATH = join(import.meta.dir, "../../cookies.txt");

export function getCookiePath(): string {
  return COOKIE_PATH;
}

export function setCookiePath(p: string): void {
  COOKIE_PATH = p;
}

export function isCookieFileValid(): boolean {
  try {
    const content = readFileSync(COOKIE_PATH, "utf-8");
    const lines = content.split("\n").filter(
      (l) => !l.startsWith("#") && l.trim() && l.split("\t").length >= 7
    );
    return lines.length > 0;
  } catch {
    return false;
  }
}

export function getCookieInfo(): { loaded: boolean; cookieCount: number; path: string } {
  try {
    const content = readFileSync(COOKIE_PATH, "utf-8");
    const lines = content.split("\n").filter(
      (l) => !l.startsWith("#") && l.trim() && l.split("\t").length >= 7
    );
    return { loaded: true, cookieCount: lines.length, path: COOKIE_PATH };
  } catch {
    return { loaded: false, cookieCount: 0, path: COOKIE_PATH };
  }
}

export function saveCookies(content: string): boolean {
  try {
    writeFileSync(COOKIE_PATH, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function loadCookies(): string {
  try {
    const content = readFileSync(COOKIE_PATH, "utf-8");
    const cookies: string[] = [];
    for (const line of content.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length >= 7) {
        cookies.push(`${parts[5]}=${parts[6]}`);
      }
    }
    return cookies.join("; ");
  } catch {
    return "";
  }
}

// ─── Latency Tracking ─────────────────────────────────────────

const latencyHistory: { timestamp: number; latencyMs: number; videoId: string }[] = [];

export function getLatencyStats() {
  const now = Date.now();
  const recent = latencyHistory.filter((l) => now - l.timestamp < 3_600_000);
  if (recent.length === 0) {
    return { avg: 0, min: 0, max: 0, p95: 0, count: 0 };
  }
  const sorted = recent.map((l) => l.latencyMs).sort((a, b) => a - b);
  return {
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
    count: sorted.length,
  };
}

// ─── Innertube Body Builder ────────────────────────────────────

function buildRequestBody(videoId: string): object {
  return {
    videoId,
    context: {
      client: {
        clientName: MWEB_CLIENT.clientName,
        clientVersion: MWEB_CLIENT.clientVersion,
        hl: MWEB_CLIENT.hl,
        gl: MWEB_CLIENT.gl,
        userAgent: MWEB_CLIENT.userAgent,
      },
    },
    contentCheckOk: true,
    racyCheckOk: true,
  };
}

// ─── Response Types ────────────────────────────────────────────

interface InnerTubePlayerResponse {
  videoDetails?: any;
  streamingData?: { formats?: any[]; adaptiveFormats?: any[] };
  playabilityStatus?: { status: string; reason?: string };
}

interface ResolvedAudio {
  streamUrl: string;
  expiresAt: number;
}

function resolveAudioStream(streamingData: any): ResolvedAudio | null {
  const adaptive: any[] = streamingData?.adaptiveFormats ?? [];
  const combined: any[] = streamingData?.formats ?? [];

  const audioStreams = adaptive
    .filter((f) => f.mimeType?.startsWith("audio/"))
    .sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

  let best = audioStreams[0];
  if (!best && combined.length > 0) {
    best = combined.sort((a: any, b: any) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
  }
  if (!best) return null;

  let url: string = best.url ?? "";
  if (!url && best.signatureCipher) {
    const params = new URLSearchParams(best.signatureCipher);
    url = params.get("url") ?? "";
  }
  if (!url) return null;

  const expiresAt = parseExpiryFromUrl(url) ?? Math.floor(Date.now() / 1000) + 3600;
  return { streamUrl: url, expiresAt };
}

// ─── Main Resolver Class ───────────────────────────────────────

export class InnertubeResolver {
  private initialized = false;
  private lastPingTime = 0;
  private pingLatency = 0;

  async init(): Promise<void> {
    console.log("[resolver] Initializing MWEB Innertube session...");
    this.initialized = true;

    // Warm up: ping YouTube to get baseline latency
    try {
      const start = performance.now();
      await fetch("https://www.youtube.com/robots.txt", { method: "HEAD" });
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
    } catch { }

    console.log("[resolver] Session ready.");
  }

  async ping(): Promise<{ latencyMs: number; reachable: boolean }> {
    try {
      const start = performance.now();
      const res = await fetch("https://www.youtube.com/robots.txt", { method: "HEAD" });
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
      return { latencyMs: this.pingLatency, reachable: res.ok };
    } catch {
      return { latencyMs: -1, reachable: false };
    }
  }

  async fetchPlayer(videoId: string): Promise<InnerTubePlayerResponse | null> {
    if (!this.initialized) throw new Error("Resolver not initialized.");

    const cookies = loadCookies();
    const body = buildRequestBody(videoId);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": MWEB_CLIENT.userAgent,
      "X-YouTube-Client-Name": "2",
      "X-YouTube-Client-Version": MWEB_CLIENT.clientVersion,
      Origin: "https://www.youtube.com",
      Referer: "https://www.youtube.com/",
    };
    if (cookies) headers["Cookie"] = cookies;

    const start = performance.now();

    try {
      const url = `${INNERTUBE_URL}?key=${INNERTUBE_KEY}&prettyPrint=false`;
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

      const latencyMs = Math.round(performance.now() - start);
      latencyHistory.push({ timestamp: Date.now(), latencyMs, videoId });
      if (latencyHistory.length > 200) latencyHistory.shift();

      this.pingLatency = latencyMs;
      this.lastPingTime = Date.now();

      if (!response.ok) {
        console.error(`[resolver] HTTP ${response.status} for videoId=${videoId}`);
        return null;
      }

      const data = (await response.json()) as InnerTubePlayerResponse;
      const status = data.playabilityStatus?.status;
      if (status && status !== "OK") {
        console.warn(`[resolver] Playability: ${status} - ${data.playabilityStatus?.reason ?? "?"}`);
        return null;
      }
      return data;
    } catch (err) {
      console.error(`[resolver] Error for videoId=${videoId}:`, err);
      return null;
    }
  }

  async resolveTrack(videoId: string): Promise<{ meta: TrackInfo; audio: ResolvedAudio } | null> {
    const data = await this.fetchPlayer(videoId);
    if (!data) return null;
    const meta = parsePlayerResponse(videoId, data);
    if (!meta) return null;
    const audio = resolveAudioStream(data.streamingData);
    if (!audio) return null;
    return { meta, audio };
  }

  async resolveAudioOnly(videoId: string): Promise<ResolvedAudio | null> {
    const data = await this.fetchPlayer(videoId);
    if (!data) return null;
    return resolveAudioStream(data.streamingData);
  }

  isReady(): boolean { return this.initialized; }

  getSessionInfo() {
    return {
      ready: this.initialized,
      client: "MWEB",
      lastPing: this.lastPingTime ? new Date(this.lastPingTime).toISOString() : null,
      latencyMs: this.pingLatency,
      cookieStatus: isCookieFileValid(),
      cookieInfo: getCookieInfo(),
    };
  }
}

export const resolver = new InnertubeResolver();
