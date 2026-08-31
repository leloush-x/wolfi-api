/**
 * resolver.ts — MWEB only via youtubei.js (stable n/sig decipher)
 */

import { type TrackInfo, formatDuration } from "./metadata";
import { parseExpiryFromUrl } from "./cache";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Innertube, Platform, UniversalCache, ClientType } from "youtubei.js";

Platform.shim.eval = async (data: any) => {
  return new Function(data.output)();
};

const MWEB_CLIENT = {
  clientName: "MWEB",
  clientVersion: "2.20240726.01.00",
  hl: "en",
  gl: "US",
  userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
};

let COOKIE_PATH = join(import.meta.dir, "../../cookies.txt");

export function getCookiePath(): string { return COOKIE_PATH; }
export function setCookiePath(p: string): void { COOKIE_PATH = p; }

export function isCookieFileValid(): boolean {
  try {
    const lines = readFileSync(COOKIE_PATH, "utf-8").split("\n").filter((l) => !l.startsWith("#") && l.trim() && l.split("\t").length >= 7);
    return lines.length > 0;
  } catch { return false; }
}

export function getCookieInfo(): { loaded: boolean; cookieCount: number; path: string } {
  try {
    const lines = readFileSync(COOKIE_PATH, "utf-8").split("\n").filter((l) => !l.startsWith("#") && l.trim() && l.split("\t").length >= 7);
    return { loaded: true, cookieCount: lines.length, path: COOKIE_PATH };
  } catch { return { loaded: false, cookieCount: 0, path: COOKIE_PATH }; }
}

export function saveCookies(content: string): boolean {
  try { writeFileSync(COOKIE_PATH, content, "utf-8"); ytInstance = null; return true; } catch { return false; }
}

function loadCookieHeader(): string | undefined {
  try {
    const parts = readFileSync(COOKIE_PATH, "utf-8")
      .split("\n").filter((l) => l.trim() && !l.startsWith("#"))
      .map((line) => { const p = line.split("\t"); return p.length >= 7 ? `${p[5]}=${p[6]}` : null; })
      .filter(Boolean) as string[];
    return parts.length > 0 ? parts.join("; ") : undefined;
  } catch { return undefined; }
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

interface ResolvedAudio { streamUrl: string; expiresAt: number; }

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

// ─── Main Resolver ────────────────────────────────────────────
export class InnertubeResolver {
  private initialized = false;
  private lastPingTime = 0;
  private pingLatency = 0;

  async init(): Promise<void> {
    console.log("[resolver] Initializing MWEB via youtubei.js...");
    this.initialized = true;
    try {
      const start = performance.now();
      await getYt();
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
      await fetch("https://www.youtube.com/robots.txt", { method: "HEAD" });
    } catch (e) { console.warn("[resolver] Warmup failed, will retry on first request", e); }
    console.log(`[resolver] MWEB ready — youtubei.js ${MWEB_CLIENT.clientVersion} cookies: ${isCookieFileValid() ? getCookieInfo().cookieCount + " loaded" : "none"}`);
  }

  async ping(): Promise<{ latencyMs: number; reachable: boolean }> {
    try {
      const start = performance.now();
      const res = await fetch("https://www.youtube.com/robots.txt", { method: "HEAD" });
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
      return { latencyMs: this.pingLatency, reachable: res.ok };
    } catch { return { latencyMs: -1, reachable: false }; }
  }

  private async fetchViaYt(videoId: string): Promise<{ info: any; url: string } | null> {
    const yt = await getYt();
    const start = performance.now();
    try {
      const info = await yt.getBasicInfo(videoId);
      const format: any = (info as any).chooseFormat({ type: "audio", quality: "best" });
      if (!format) { console.warn(`[resolver] [MWEB] No audio format for ${videoId}`); return null; }
      const url = await format.decipher(yt.session.player);
      const latencyMs = Math.round(performance.now() - start);
      latencyHistory.push({ timestamp: Date.now(), latencyMs, videoId });
      if (latencyHistory.length > 200) latencyHistory.shift();
      this.pingLatency = latencyMs;
      this.lastPingTime = Date.now();
      if (!url) { console.warn(`[resolver] [MWEB] No URL after decipher for ${videoId}`); return null; }
      return { info, url };
    } catch (err: any) {
      const latencyMs = Math.round(performance.now() - start);
      latencyHistory.push({ timestamp: Date.now(), latencyMs, videoId });
      if (latencyHistory.length > 200) latencyHistory.shift();
      const msg = err?.message ?? String(err);
      if (msg.includes("LOGIN_REQUIRED") || msg.includes("Sign in") || msg.includes("bot")) {
        console.warn(`[resolver] [MWEB] Playability: LOGIN_REQUIRED - ${msg} for ${videoId}`);
      } else { console.error(`[resolver] [MWEB] Error for ${videoId}:`, msg); }
      return null;
    }
  }

  async resolveTrack(videoId: string): Promise<{ meta: TrackInfo; audio: ResolvedAudio } | null> {
    const res = await this.fetchViaYt(videoId);
    if (!res) return null;
    const info: any = res.info;
    const basic = info.basic_info ?? {};
    const meta: TrackInfo = {
      videoId,
      title: basic.title ?? "Unknown Title",
      channel: basic.author ?? basic.channel?.name ?? "Unknown Artist",
      duration: basic.duration ?? 0,
      durationFormatted: formatDuration(basic.duration ?? 0),
      thumbnail: basic.thumbnail?.[0]?.url ?? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      ytLink: `https://www.youtube.com/watch?v=${videoId}`,
    };
    const expiresAt = parseExpiryFromUrl(res.url) ?? Math.floor(Date.now() / 1000) + 3600;
    return { meta, audio: { streamUrl: res.url, expiresAt } };
  }

  async resolveAudioOnly(videoId: string): Promise<ResolvedAudio | null> {
    const res = await this.fetchViaYt(videoId);
    if (!res) return null;
    return { streamUrl: res.url, expiresAt: parseExpiryFromUrl(res.url) ?? Math.floor(Date.now() / 1000) + 3600 };
  }

  isReady(): boolean { return this.initialized; }

  getSessionInfo() {
    return {
      ready: this.initialized, client: "MWEB", clientVersion: MWEB_CLIENT.clientVersion,
      lastPing: this.lastPingTime ? new Date(this.lastPingTime).toISOString() : null,
      latencyMs: this.pingLatency, cookieStatus: isCookieFileValid(), cookieInfo: getCookieInfo(), engine: "youtubei.js",
    };
  }
}

export const resolver = new InnertubeResolver();
