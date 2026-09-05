/**
 * resolver.ts — MWEB only via youtubei.js (stable n/sig decipher)
 *
 * Hardening vs before:
 * - single-flight: same videoId × N concurrent requests → 1 YouTube fetch
 * - semaphore: max YT_MAX_CONCURRENT parallel InnerTube calls (no 429 self-DDoS)
 * - cookies centralized in core/cookies.ts (no duplicate parser)
 * - engine version read once, no per-request require()
 */

import { type TrackInfo, formatDuration } from "./metadata";
import { parseExpiryFromUrl } from "./cache";
import { MWEB_CLIENT, YT_MAX_CONCURRENT } from "./constants";
import {
  getCookieHeader,
  getCookieInfo,
  isCookieFileValid,
  saveCookies,
  getCookiePath,
} from "./cookies";
import { createLimiter, singleflight } from "./singleflight";
import { Innertube, Platform, UniversalCache, ClientType } from "youtubei.js";
import pkg from "youtubei.js/package.json";

export { getCookiePath, isCookieFileValid, getCookieInfo, saveCookies };

const ENGINE_VERSION: string = (pkg as any)?.version ?? "unknown";

Platform.shim.eval = async (data: any) => {
  return new Function(data.output)();
};

// ─── Latency Tracking (capped ring, no unbounded growth) ────
const LAT_MAX = 200;
const latencyHistory: { timestamp: number; latencyMs: number; videoId: string }[] = [];

function recordLatency(videoId: string, latencyMs: number): void {
  latencyHistory.push({ timestamp: Date.now(), latencyMs, videoId });
  if (latencyHistory.length > LAT_MAX) latencyHistory.splice(0, latencyHistory.length - LAT_MAX);
}

export function getLatencyStats() {
  const now = Date.now();
  const recent = latencyHistory.filter((l) => now - l.timestamp < 3_600_000);
  if (recent.length === 0) return { avg: 0, min: 0, max: 0, p95: 0, count: 0 };
  const sorted = recent.map((l) => l.latencyMs).sort((a, b) => a - b);
  return {
    avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    count: sorted.length,
  };
}

export function getLatencyHistory(): { timestamp: number; latencyMs: number; videoId: string }[] {
  const now = Date.now();
  return latencyHistory.filter((l) => now - l.timestamp < 3_600_000);
}

interface ResolvedAudio {
  streamUrl: string;
  expiresAt: number;
}

// ─── youtubei.js singleton + concurrency guard ──────────────
let ytInstance: any = null;
let ytInitPromise: Promise<any> | null = null;
const ytLimiter = createLimiter(YT_MAX_CONCURRENT);

export function getLimiterStats() {
  return ytLimiter.stats();
}

async function getYt(): Promise<any> {
  if (ytInstance) return ytInstance;
  if (!ytInitPromise) {
    ytInitPromise = (async () => {
      const cookie = getCookieHeader();
      const yt = await Innertube.create({
        client_type: ClientType.MWEB,
        cache: new UniversalCache(false),
        generate_session_locally: true,
        ...(cookie ? { cookie } : {}),
      });
      ytInstance = yt;
      return yt;
    })().catch((e) => {
      ytInitPromise = null;
      throw e;
    });
  }
  return ytInitPromise;
}

/** Call when cookies are replaced so the next request picks them up. */
export function resetSession(): void {
  ytInstance = null;
  ytInitPromise = null;
}

// ─── Main Resolver ──────────────────────────────────────────
export class InnertubeResolver {
  private initialized = false;
  private warmed = false;
  private lastPingTime = 0;
  private pingLatency = 0;

  async init(): Promise<void> {
    console.log("[resolver] Initializing MWEB via youtubei.js...");
    this.initialized = true;
    try {
      const start = performance.now();
      await getYt();
      this.warmed = true;
      this.pingLatency = Math.round(performance.now() - start);
      this.lastPingTime = Date.now();
      // Non-blocking warmup probe; never fail boot on it.
      fetch("https://www.youtube.com/robots.txt", { method: "HEAD" }).catch(() => {});
    } catch (e) {
      console.warn("[resolver] Warmup failed, will retry on first request", e);
    }
    const ci = getCookieInfo();
    console.log(
      `[resolver] MWEB ready — youtubei.js ${MWEB_CLIENT.clientVersion} cookies: ${ci.loaded ? ci.cookieCount + " loaded" : "none"}`,
    );
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

  private fetchViaYt(videoId: string): Promise<{ info: any; url: string } | null> {
    // Single-flight + limiter: the core anti-rate-limit fix.
    return singleflight(`yt:${videoId}`, () =>
      ytLimiter.run(async () => {
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
          recordLatency(videoId, latencyMs);
          this.pingLatency = latencyMs;
          this.lastPingTime = Date.now();
          if (!url) {
            console.warn(`[resolver] [MWEB] No URL after decipher for ${videoId}`);
            return null;
          }
          return { info, url };
        } catch (err: any) {
          recordLatency(videoId, Math.round(performance.now() - start));
          const msg = err?.message ?? String(err);
          if (msg.includes("LOGIN_REQUIRED") || msg.includes("Sign in") || msg.includes("bot")) {
            console.warn(`[resolver] [MWEB] Playability: LOGIN_REQUIRED - ${msg} for ${videoId}`);
          } else {
            console.error(`[resolver] [MWEB] Error for ${videoId}:`, msg);
          }
          return null;
        }
      }),
    );
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
      thumbnail:
        basic.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ??
        `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      ytLink: `https://www.youtube.com/watch?v=${videoId}`,
    };
    const expiresAt = parseExpiryFromUrl(res.url) ?? Math.floor(Date.now() / 1000) + 3600;
    return { meta, audio: { streamUrl: res.url, expiresAt } };
  }

  async resolveAudioOnly(videoId: string): Promise<ResolvedAudio | null> {
    const res = await this.fetchViaYt(videoId);
    if (!res) return null;
    return {
      streamUrl: res.url,
      expiresAt: parseExpiryFromUrl(res.url) ?? Math.floor(Date.now() / 1000) + 3600,
    };
  }

  isReady(): boolean {
    return this.initialized;
  }

  isWarmed(): boolean {
    return this.warmed;
  }

  getSessionInfo() {
    const ci = getCookieInfo();
    return {
      ready: this.initialized,
      warmed: this.warmed,
      client: "MWEB",
      clientVersion: MWEB_CLIENT.clientVersion,
      lastPing: this.lastPingTime ? new Date(this.lastPingTime).toISOString() : null,
      latencyMs: this.pingLatency,
      cookieStatus: ci.loaded,
      cookieInfo: ci,
      engine: "youtubei.js",
      engineVersion: ENGINE_VERSION,
      ytConcurrency: getLimiterStats(),
    };
  }
}

export const resolver = new InnertubeResolver();
