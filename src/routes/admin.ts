/**
 * admin.ts - Handler for GET /admin
 */

import { getCacheStats, flushCache, purgeExpiredStreams, getRequestStats, isCacheEnabled, setCacheEnabled } from "../core/cache";
import { resolver, saveCookies, getCookieInfo, getLatencyStats } from "../core/resolver";
import { readEnv, writeEnv } from "../core/env";
import { listPackages, updatePackages } from "../core/packages";

export async function handleAdmin(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (req.method === "POST") {
    try {
      const body = await req.json() as any;
      if (body.action === "toggle_cache") { setCacheEnabled(body.enabled); return json({ ok: true, cacheEnabled: body.enabled }); }
      if (body.action === "flush_cache") { return json({ ok: true, ...flushCache() }); }
      if (body.action === "purge_expired") { return json({ ok: true, purged: purgeExpiredStreams() }); }
      if (body.action === "upload_cookies" && typeof body.content === "string") { return json({ ok: saveCookies(body.content), cookieInfo: getCookieInfo() }); }
      if (body.action === "update_env" && typeof body.config === "object") {
        const env = readEnv();
        for (const [k, v] of Object.entries(body.config)) { v == null ? delete env[k] : (env[k] = String(v)); }
        writeEnv(env);
        return json({ ok: true, config: env });
      }
      if (body.action === "get_config") return json({ ok: true, config: readEnv() });
      if (body.action === "list_packages") { const pkgs = await listPackages(true); return json({ ok: true, packages: pkgs }); }
      if (body.action === "update_packages") {
        const result = await updatePackages(body.packages);
        return json({ ok: true, ...result });
      }
    } catch { return json({ error: "Invalid request body" }, 400); }
  }

  if (action === "flush") return json({ action: "flush", result: flushCache() });
  if (action === "purge") return json({ action: "purge", result: { expiredStreamsDeleted: purgeExpiredStreams() } });

  const memUsage = process.memoryUsage();
  const uptime = process.uptime();
  return json({
    system: {
      uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
      uptimeSeconds: Math.floor(uptime),
      memory: {
        rss: formatBytes(memUsage.rss), heapUsed: formatBytes(memUsage.heapUsed),
        heapTotal: formatBytes(memUsage.heapTotal), external: formatBytes(memUsage.external),
        rssBytes: memUsage.rss, heapUsedBytes: memUsage.heapUsed,
      },
      bunVersion: typeof Bun !== "undefined" ? Bun.version : "unknown",
      platform: process.platform, arch: process.arch,
    },
    session: resolver.getSessionInfo(),
    requests: getRequestStats(),
    latency: getLatencyStats(),
    cache: getCacheStats(),
    config: readEnv(),
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
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}
