/**
 * resolver.ts — MWEB only via youtubei.js (stable n/sig decipher)
 * Uses youtubei.js Innertube MWEB + cookies.txt + Platform.shim.eval
 */

import { parsePlayerResponse, type TrackInfo } from "./metadata";
import { parseExpiryFromUrl } from "./cache";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { Innertube, Platform, UniversalCache, ClientType } from "youtubei.js";

// Required for signature decipher (WEB/MWEB cipher)
Platform.shim.eval = async (data: any) => {
  return new Function(data.output)();
};

// ─── MWEB Client ─────────────────────────────────────────
const MWEB_CLIENT = {
  clientName: "MWEB",
  clientVersion: "2.20240726.01.00",
  hl: "en",
  gl: "US",
  userAgent:
    "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
};

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
    const lines = content.split("\n").filter((l) => !l.startsWith("#") && l.trim() && l.split("\t").length >= 7);
    return lines.length > 0;
  } catch {
    return false;
  }
}
export function getCookieInfo(): { loaded: boolean; cookieCount: number; path: string } {
  try {
    const content = readFileSync(COOKIE_PATH, "utf-8");
    const lines = content.split("\n").filter((l) => !l.startsWith("#") && l.trim() && l.split("\t").length >= 7);
    return { loaded: true, cookieCount: lines.length, path: COOKIE_PATH };
  } catch {
    return { loaded: false, cookieCount: 0, path: COOKIE_PATH };
  }
}
export function saveCookies(content: string): boolean {
  try {
    writeFileSync(COOKIE_PATH, content, "utf-8");
    ytInstance = null; // force re-create with new cookies
    return true;
  } catch {
    return false;
  }
}

function loadCookieHeader(): string | undefined {
  try {
    const raw = readFileSync(COOKIE_PATH, "utf-8");
    const parts = raw
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((line) => {
        const p = line.split("\t");
        if (p.length < 7) return null;
        return `${p[5]}=${p[6]}`;
      })
      .filter(Boolean) as string[];
    if (parts.length === 0) return undefined;
    return parts.join("; ");
  } catch {
    return undefined;
  }
}

// ─── Latency Tracking ─────────────────────────────────────────
const latencyHistory: { timestamp: number; latencyMs: number; videoId: string }[] = [];
export function getLatencyStats() {
  const now = Date.now();
  const recent = latencyHistory.filter((l) => now - l.timestamp < 3_600_000);
  if (recent.length === 0) return { avg: 0, min: 0, max: 0, p95: 0, count: 0 };
  const sorted = recent.map((l) => l.latencyMs).sort((a, b) => a - b);
  return {
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1],
    count: sorted.length,
  };
}

interface ResolvedAudio {
  streamUrl: string;
  expiresAt: number;
}

// ─── youtubei.js singleton ────────────────────────────────────
let ytInstance: any = null;
async function getYt(): Promise<any> {
  if (ytInstance) return ytInstance;
  const cookie = loadCookieHeader();
  ytInstance = await Innertube.create({
    client_type: ClientType.MWEB,
    cache: new UniversalCache(false),
    generate_session_locally: true,
    ...(cookie ? { cookie } : {}),
  });
  return ytInstance;
}

// ─── Main Resolver (MWEB only) ───────────────────────────────────────
export class InnertubeResolver {
  private initialized = false;
  private lastPingTime = 0;
  private pingLatency = 0;

  async init(): Promise<void> {
    console.log("[resolver] Initializing MWEB via youtubei.js...");
    this.initialized = true;
    // Warm up youtubei.js session
    try {
      const start = performance.now();
      await getYt();
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
      // Also ping youtube
      await fetch("https://www.youtube.com/robots.txt", { method: "HEAD" });
    } catch (e) {
      console.warn("[resolver] Warmup failed, will retry on first request", e);
    }
    console.log(`[resolver] MWEB ready — youtubei.js ${MWEB_CLIENT.clientVersion} cookies: ${isCookieFileValid() ? getCookieInfo().cookieCount + " loaded" : "none"}`);
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

  // Internal: getBasicInfo + decipher bestaudio
  private async fetchViaYt(videoId: string): Promise<{ info: any; url: string } | null> {
    const yt = await getYt();
    const start = performance.now();
    try {
      const info = await yt.getBasicInfo(videoId);
      const format: any = (info as any).chooseFormat({ type: "audio", quality: "best" });
      if (!format) {
        console.warn(`[resolver] [MWEB] No audio format for ${videoId}`);
        return null;
      }
      const url = await format.decipher(yt.session.player);
      const latencyMs = Math.round(performance.now() - start);
      latencyHistory.push({ timestamp: Date.now(), latencyMs, videoId });
      if (latencyHistory.length > 200) latencyHistory.shift();
      this.pingLatency = latencyMs;
      this.lastPingTime = Date.now();
      if (!url) {
        console.warn(`[resolver] [MWEB] No URL after decipher for ${videoId}`);
        return null;
      }
      return { info, url };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      latencyHistory.push({ timestamp: Date.now(), latencyMs, videoId });
      if (latencyHistory.length > 200) latencyHistory.shift();
      // Detect bot check
      const msg = err?.message ?? String(err);
      if (msg.includes("LOGIN_REQUIRED") || msg.includes("Sign in") || msg.includes("bot")) {
        console.warn(`[resolver] [MWEB] Playability: LOGIN_REQUIRED - ${msg} for ${videoId}`);
      } else {
        console.error(`[resolver] [MWEB] Error for ${videoId}:`, msg);
      }
      return null;
    }
  }

  async fetchPlayer(videoId: string): Promise<any | null> {
    // For compat, return a minimal player-like object via youtubei.js
    const res = await this.fetchViaYt(videoId);
    if (!res) return null;
    // Build a fake InnerTube-like response for parsePlayerResponse compatibility
    const info = res.info;
    const basic = (info as any).basic_info ?? (info as any).info ?? {};
    const videoDetails = {
      videoId,
      title: basic.title ?? info?.basic_info?.title ?? "Unknown",
      author: basic.author ?? basic.channel?.name ?? "Unknown",
      lengthSeconds: String(basic.duration ?? 0),
      channelId: basic.channel_id ?? basic.channel?.id ?? "",
      thumbnails: basic.thumbnail ?? [],
    };
    // Need streamingData for resolveAudioStream compatibility, but we already have URL
    // Return a synthetic streamingData with single adaptive format
    const syntheticData = {
      videoDetails,
      streamingData: {
        adaptiveFormats: [{ mimeType: "audio/webm", bitrate: 0, url: res.url }],
      },
      playabilityStatus: { status: "OK" },
      _ytInfo: info,
      _decipheredUrl: res.url,
    };
    return syntheticData as any;
  }

  async resolveTrack(videoId: string): Promise<{ meta: TrackInfo; audio: ResolvedAudio } | null> {
    const res = await this.fetchViaYt(videoId);
    if (!res) return null;
    const info: any = res.info;
    const basic = info.basic_info ?? {};
    const title: string = basic.title ?? "Unknown Title";
    const channel: string = basic.author ?? basic.channel?.name ?? "Unknown Artist";
    const duration: number = basic.duration ?? 0;
    const thumbnail: string = basic.thumbnail?.[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    const meta: TrackInfo = {
      videoId,
      title,
      channel,
      duration,
      durationFormatted: formatDuration(duration),
      thumbnail,
      ytLink: `https://www.youtube.com/watch?v=${videoId}`,
    };
    const expiresAt = parseExpiryFromUrl(res.url) ?? Math.floor(Date.now() / 1000) + 3600;
    return { meta, audio: { streamUrl: res.url, expiresAt } };
  }

  async resolveAudioOnly(videoId: string): Promise<ResolvedAudio | null> {
    const res = await this.fetchViaYt(videoId);
    if (!res) return null;
    const expiresAt = parseExpiryFromUrl(res.url) ?? Math.floor(Date.now() / 1000) + 3600;
    return { streamUrl: res.url, expiresAt };
  }

  isReady(): boolean {
    return this.initialized;
  }

  getSessionInfo() {
    return {
      ready: this.initialized,
      client: "MWEB",
      clientVersion: MWEB_CLIENT.clientVersion,
      lastPing: this.lastPingTime ? new Date(this.lastPingTime).toISOString() : null,
      latencyMs: this.pingLatency,
      cookieStatus: isCookieFileValid(),
      cookieInfo: getCookieInfo(),
      engine: "youtubei.js",
    };
  }
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const resolver = new InnertubeResolver();
