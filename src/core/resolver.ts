/**
 * resolver.ts - Persistent MWEB Innertube session & audio stream resolver
 * Updated: Dynamic cookie reload, cookie status, latency tracking.
 */

import { parsePlayerResponse, type TrackInfo } from "./metadata";
import { parseExpiryFromUrl } from "./cache";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

// ─── Client Constants (IOS primary - MWEB currently UNPLAYABLE) ───────
const IOS_CLIENT = {
  clientName: "IOS",
  clientVersion: "20.45.31",
  hl: "en",
  gl: "US",
  userAgent: "com.google.ios.youtube/20.45.31 (iPhone14,5; U; CPU iOS 17_5_1 like Mac OS X)",
  deviceModel: "iPhone14,5",
  osName: "iOS",
  osVersion: "17.5.1.21F90",
} as const;

const ANDROID_CLIENT = {
  clientName: "ANDROID",
  clientVersion: "20.42.33",
  hl: "en",
  gl: "US",
  userAgent: "com.google.android.youtube/20.42.33 (Linux; U; Android 13; Pixel 7) gzip",
  androidSdkVersion: 33,
} as const;

// Fallback MWEB (kept for reference, currently blocked - shows UNPLAYABLE)
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

function buildRequestBody(videoId: string, client: any = IOS_CLIENT): object {
  const base: any = {
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    hl: client.hl,
    gl: client.gl,
  };
  // IOS specific fields help bypass UNPLAYABLE
  if (client === IOS_CLIENT) {
    base.deviceModel = (client as any).deviceModel;
    base.osName = (client as any).osName;
    base.osVersion = (client as any).osVersion;
  } else if (client === ANDROID_CLIENT) {
    base.androidSdkVersion = (client as any).androidSdkVersion;
  }
  // userAgent is top-level inside context.client for some clients but also include
  if (client.userAgent) base.userAgent = client.userAgent;

  return {
    videoId,
    context: { client: base },
    contentCheckOk: true,
    racyCheckOk: true,
  };
}

function getClientHeaders(client: any): Record<string,string> {
  const map: Record<string,string> = { MWEB:"2", IOS:"5", ANDROID:"3" };
  const clientNameId = map[client.clientName] ?? "5";
  return {
    "Content-Type": "application/json",
    "User-Agent": client.userAgent,
    "X-YouTube-Client-Name": clientNameId,
    "X-YouTube-Client-Version": client.clientVersion,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
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
  private activeClient: any = IOS_CLIENT;

  async init(): Promise<void> {
    console.log("[resolver] Initializing IOS Innertube session (MWEB blocked)...");
    this.initialized = true;

    // Warm up: ping YouTube to get baseline latency
    try {
      const start = performance.now();
      await fetch("https://www.youtube.com/robots.txt", { method: "HEAD" });
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
    } catch { }

    console.log(`[resolver] Session ready. Primary client: ${this.activeClient.clientName} ${this.activeClient.clientVersion}`);
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

  private async fetchWithClient(videoId: string, client: any): Promise<InnerTubePlayerResponse | null> {
    const cookies = loadCookies();
    const body = buildRequestBody(videoId, client);
    const headers = getClientHeaders(client);
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
        console.error(`[resolver] [${client.clientName}] HTTP ${response.status} for videoId=${videoId}`);
        return null;
      }
      const data = (await response.json()) as InnerTubePlayerResponse;
      const status = data.playabilityStatus?.status;
      if (status && status !== "OK") {
        console.warn(`[resolver] [${client.clientName}] Playability: ${status} - ${data.playabilityStatus?.reason ?? "?"} for ${videoId}`);
        return null;
      }
      // success - remember active client
      this.activeClient = client;
      return data;
    } catch (err) {
      console.error(`[resolver] [${client.clientName}] Error for videoId=${videoId}:`, err);
      return null;
    }
  }

  async fetchPlayer(videoId: string): Promise<InnerTubePlayerResponse | null> {
    if (!this.initialized) throw new Error("Resolver not initialized.");

    // Primary IOS -> fallback ANDROID -> last resort MWEB (currently blocked)
    const clients = [IOS_CLIENT, ANDROID_CLIENT, MWEB_CLIENT];
    for (const client of clients) {
      const data = await this.fetchWithClient(videoId, client);
      if (data) {
        if (client !== IOS_CLIENT) console.log(`[resolver] Fallback success with ${client.clientName} for ${videoId}`);
        return data;
      }
    }
    console.error(`[resolver] All clients failed for videoId=${videoId}`);
    return null;
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
      client: this.activeClient?.clientName ?? "IOS",
      clientVersion: this.activeClient?.clientVersion ?? IOS_CLIENT.clientVersion,
      lastPing: this.lastPingTime ? new Date(this.lastPingTime).toISOString() : null,
      latencyMs: this.pingLatency,
      cookieStatus: isCookieFileValid(),
      cookieInfo: getCookieInfo(),
    };
  }

  getActiveClient() { return this.activeClient; }
}

export const resolver = new InnertubeResolver();
