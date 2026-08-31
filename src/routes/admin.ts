/**
 * admin.ts - Handler for GET /admin
 * Real-time health dashboard / diagnostic JSON + admin actions.
 */

import {
  getCacheStats, flushCache, purgeExpiredStreams,
  getRequestStats, isCacheEnabled, setCacheEnabled
} from "../core/cache";
import { resolver, saveCookies, getCookieInfo } from "../core/resolver";

const ENV_PATH = join(import.meta.dir, "../../.env");
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(ENV_PATH)) return env;
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return env;
}

function writeEnv(env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

export async function handleAdmin(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // ── POST actions (body-driven) ──────────────────────────
  if (req.method === "POST") {
    try {
      const body = await req.json() as any;

      // Toggle cache
      if (body.action === "toggle_cache") {
        setCacheEnabled(body.enabled);
        return json({ ok: true, cacheEnabled: body.enabled });
      }

      // Flush cache
      if (body.action === "flush_cache") {
        const result = flushCache();
        return json({ ok: true, ...result });
      }

      // Purge expired
      if (body.action === "purge_expired") {
        const purged = purgeExpiredStreams();
        return json({ ok: true, purged });
      }

      // Upload cookies
      if (body.action === "upload_cookies" && typeof body.content === "string") {
        const ok = saveCookies(body.content);
        return json({ ok, cookieInfo: getCookieInfo() });
      }

      // Update env
      if (body.action === "update_env" && typeof body.config === "object") {
        const env = readEnv();
        for (const [k, v] of Object.entries(body.config)) {
          if (v === null || v === undefined) {
            delete env[k];
          } else {
            env[k] = String(v);
          }
        }
        writeEnv(env);
        return json({ ok: true, config: env });
      }

      // Get env config
      if (body.action === "get_config") {
        return json({ ok: true, config: readEnv() });
      }
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
  }

  // ── GET actions ─────────────────────────────────────────
  if (action === "flush") {
    const result = flushCache();
    return json({ action: "flush", result });
  }

  if (action === "purge") {
    const purged = purgeExpiredStreams();
    return json({ action: "purge", result: { expiredStreamsDeleted: purged } });
  }

  // Default: full dashboard
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  const cacheStats = getCacheStats();
  const requestStats = getRequestStats();
  const sessionInfo = resolver.getSessionInfo();
  const latencyStats = (await import("../core/resolver")).getLatencyStats();
  const envConfig = readEnv();

  return json({
    system: {
      uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
      uptimeSeconds: Math.floor(uptime),
      memory: {
        rss: formatBytes(memUsage.rss),
        heapUsed: formatBytes(memUsage.heapUsed),
        heapTotal: formatBytes(memUsage.heapTotal),
        external: formatBytes(memUsage.external),
        rssBytes: memUsage.rss,
        heapUsedBytes: memUsage.heapUsed,
      },
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
      platform: process.platform,
      arch: process.arch,
    },
    session: sessionInfo,
    requests: requestStats,
    latency: latencyStats,
    cache: cacheStats,
    config: envConfig,
    timestamp: new Date().toISOString(),
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
