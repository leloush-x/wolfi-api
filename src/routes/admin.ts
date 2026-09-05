/**
 * admin.ts - Handler for /admin (GET status, POST actions)
 *
 * Auth: if ADMIN_TOKEN is set (env or .env file), mutating actions and the
 * full status payload require `Authorization: Bearer <token>` or `?token=`.
 * If unset (default local dev), everything stays open — response includes
 * `auth: "open"` so the dashboard can warn you.
 */

import {
  getCacheStats,
  flushCache,
  purgeExpiredStreams,
  getRequestStats,
  isCacheEnabled,
  setCacheEnabled,
} from "../core/cache";
import { resolver, saveCookies, getCookieInfo, getLatencyStats, getLatencyHistory } from "../core/resolver";
import { resetSession } from "../core/resolver";
import { readEnv, writeEnv } from "../core/env";
import { listPackages, updatePackages } from "../core/packages";
import { jsonPretty, json, requireMethod, formatBytes, formatUptime } from "../core/http";
import { inflightCount } from "../core/singleflight";
import { APP_NAME, APP_VERSION } from "../core/constants";

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const PKG_NAME_RE = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;

function adminToken(): string {
  return process.env.ADMIN_TOKEN ?? readEnv().ADMIN_TOKEN ?? "";
}

function authorized(req: Request, url: URL): boolean {
  const token = adminToken();
  if (!token) return true; // open local-dev mode
  const header = req.headers.get("authorization") ?? "";
  if (header === `Bearer ${token}`) return true;
  if (url.searchParams.get("token") === token) return true;
  return false;
}

export async function handleAdmin(req: Request): Promise<Response> {
  const methodErr = requireMethod(req, ["GET", "POST"]);
  if (methodErr) return methodErr;
  const url = new URL(req.url);
  const locked = adminToken() !== "";
  const authed = authorized(req, url);

  if (req.method === "POST") {
    if (!authed) return json({ error: "unauthorized" }, 401);
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request body" }, 400);
    }
    if (!body || typeof body.action !== "string") return json({ error: "Missing action" }, 400);

    if (body.action === "toggle_cache") {
      if (typeof body.enabled !== "boolean") return json({ error: "enabled must be boolean" }, 400);
      setCacheEnabled(body.enabled);
      return json({ ok: true, cacheEnabled: body.enabled });
    }
    if (body.action === "flush_cache") return json({ ok: true, ...flushCache() });
    if (body.action === "purge_expired") return json({ ok: true, purged: purgeExpiredStreams() });
    if (body.action === "upload_cookies" && typeof body.content === "string") {
      if (body.content.length > 500_000) return json({ error: "Cookie file too large" }, 413);
      const ok = saveCookies(body.content);
      if (ok) resetSession();
      return json({ ok, cookieInfo: getCookieInfo() });
    }
    if (body.action === "update_env" && body.config && typeof body.config === "object") {
      const entries = Object.entries(body.config).slice(0, 100);
      for (const [k] of entries) {
        if (!ENV_KEY_RE.test(k)) return json({ error: `Invalid env key: ${k}` }, 400);
      }
      const env = readEnv();
      for (const [k, v] of entries) {
        if (v == null) delete env[k];
        else env[k] = String(v).slice(0, 5000);
      }
      delete env.ADMIN_TOKEN; // token can only be set via real env file, never the API
      writeEnv(env);
      return json({ ok: true, config: env });
    }
    if (body.action === "get_config") return json({ ok: true, config: sanitizeConfig(readEnv()) });
    if (body.action === "list_packages") {
      const pkgs = await listPackages(true);
      return json({ ok: true, packages: pkgs });
    }
    if (body.action === "update_packages") {
      if (body.packages !== undefined) {
        if (!Array.isArray(body.packages) || body.packages.length > 50) {
          return json({ error: "packages must be an array of ≤50 names" }, 400);
        }
        for (const p of body.packages) {
          if (typeof p !== "string" || !PKG_NAME_RE.test(p)) {
            return json({ error: `Invalid package name: ${p}` }, 400);
          }
        }
      }
      const result = await updatePackages(body.packages);
      return json({ ok: true, ...result });
    }
    return json({ error: `Unknown action: ${body.action}` }, 400);
  }

  // ─── GET ───
  const action = url.searchParams.get("action");
  if (action === "flush" || action === "purge") {
    if (!authed) return json({ error: "unauthorized" }, 401);
    if (action === "flush") return json({ action: "flush", result: flushCache() });
    return json({ action: "purge", result: { expiredStreamsDeleted: purgeExpiredStreams() } });
  }
  if (!authed && locked) return json({ error: "unauthorized" }, 401);

  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  const uptimeSeconds = Math.floor(uptime);
  return jsonPretty({
    service: APP_NAME,
    version: APP_VERSION,
    auth: locked ? "locked" : "open",
    system: {
      uptime: formatUptime(uptimeSeconds),
      uptimeSeconds,
      startedAt: new Date(Date.now() - uptimeSeconds * 1000).toISOString(),
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
    session: resolver.getSessionInfo(),
    requests: getRequestStats(),
    inflight: inflightCount(),
    latency: { ...getLatencyStats(), history: getLatencyHistory() },
    cache: getCacheStats(),
    cacheEnabled: isCacheEnabled(),
    config: sanitizeConfig(readEnv()),
    timestamp: new Date().toISOString(),
  });
}

function sanitizeConfig(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  for (const k of Object.keys(out)) {
    if (/TOKEN|SECRET|KEY|COOKIE/i.test(k) && out[k]) out[k] = "***";
  }
  return out;
}
