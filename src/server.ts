/**
 * server.ts — entry point.
 * Bun.serve() route dispatcher + zero-copy static SPA fallback.
 *
 * Performance notes (why this is fast AND idle-light):
 * - Bun.file() serves statics zero-copy without blocking the event loop
 *   (old code used readFileSync+existsSync per request = event-loop stalls).
 * - No per-request disk reads on API paths (env/cookies are mtime-cached).
 * - Single-flight + semaphore in resolver caps YouTube concurrency.
 * - Bun itself multiplexes I/O across native threads; JS stays single-thread
 *   so there is nothing to "underclock" — just don't block it.
 */

import { handleInfo } from "./routes/info";
import { handleSaudio } from "./routes/saudio";
import { handleAdmin } from "./routes/admin";
import { resolver } from "./core/resolver";
import { purgeExpiredStreams } from "./core/cache";
import { loadEnvIntoProcess, getPort, getHost } from "./core/env";
import { APP_NAME, APP_VERSION, WEB_DIST, isHashedAsset, mimeFor } from "./core/constants";
import { corsPreflight, json, nextRequestId, log } from "./core/http";
import { join } from "path";

loadEnvIntoProcess();
const PORT = getPort();
const HOST = getHost();

function matchRoute(pathname: string): { type: string; param?: string } | null {
  if (pathname === "/info") return { type: "info" };
  if (pathname.startsWith("/saudio/")) {
    return { type: "saudio", param: pathname.slice("/saudio/".length).split("/")[0].split("?")[0] };
  }
  if (pathname === "/admin") return { type: "admin" };
  if (pathname === "/health") return { type: "health" };
  if (pathname === "/version") return { type: "version" };
  return null;
}

console.log(`🐺 ${APP_NAME} v${APP_VERSION} starting up...`);
// Warm up InnerTube in the background — never block listening on it.
// If YouTube is slow/unreachable, /health still answers and the first
// /info or /saudio request lazily finishes init via the shared singleton.
resolver.init().catch((e) => console.warn("[resolver] background init failed", e));

// Periodic cleanup every 5 minutes (unref'd → never keeps process awake alone).
const cleanupTimer = setInterval(() => {
  try {
    const purged = purgeExpiredStreams();
    if (purged > 0) console.log(`[cleanup] Purged ${purged} expired stream URLs`);
  } catch (e) {
    console.warn("[cleanup] failed", e);
  }
}, 5 * 60 * 1000);
if (typeof (cleanupTimer as any)?.unref === "function") (cleanupTimer as any).unref();

function withSecurity(h: Headers): Headers {
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  return h;
}

async function serveStatic(pathname: string): Promise<Response | null> {
  let rel = pathname === "/" ? "index.html" : pathname.slice(1);
  // Block traversal without allocating: reject .. segments and null bytes.
  if (rel.includes("..") || rel.includes("\0")) {
    return new Response("Forbidden", { status: 403 });
  }
  const filePath = join(WEB_DIST, rel);
  if (!filePath.startsWith(WEB_DIST)) return new Response("Forbidden", { status: 403 });

  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  const h = new Headers({
    "Content-Type": mimeFor(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  if (rel === "index.html" || rel.endsWith(".html")) {
    // Entry HTML must revalidate or deploys look stale forever.
    h.set("Cache-Control", "no-cache");
  } else if (isHashedAsset("/" + rel)) {
    h.set("Cache-Control", "public, max-age=31536000, immutable");
  } else {
    h.set("Cache-Control", "public, max-age=3600");
  }
  return new Response(file as any, { headers: h });
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  async fetch(req) {
    const rid = nextRequestId();
    const t0 = performance.now();
    const url = new URL(req.url);
    const pathname = url.pathname;
    let status = 200;

    try {
      if (req.method === "OPTIONS") return corsPreflight();

      const route = matchRoute(pathname);
      if (route) {
        let res: Response;
        switch (route.type) {
          case "info":
            res = await handleInfo(req);
            break;
          case "saudio":
            res = await handleSaudio(req, route.param!);
            break;
          case "admin":
            res = await handleAdmin(req);
            break;
          case "health":
            res = json({
              status: "ok",
              service: APP_NAME,
              version: APP_VERSION,
              ready: resolver.isReady(),
              warmed: resolver.isWarmed(),
              time: new Date().toISOString(),
            });
            break;
          case "version":
            res = json({ service: APP_NAME, version: APP_VERSION });
            break;
          default:
            res = json({ error: "not_found" }, 404);
        }
        status = res.status;
        withSecurity(res.headers);
        return res;
      }

      // Static assets → SPA fallback → JSON fallback.
      const staticRes = await serveStatic(pathname);
      if (staticRes) {
        status = 200;
        return staticRes;
      }
      const indexRes = await serveStatic("/");
      if (indexRes) {
        status = 200;
        return indexRes;
      }

      status = 200;
      return json({
        service: APP_NAME,
        version: APP_VERSION,
        status: "running",
        endpoints: {
          info: "GET /info?q=<url|id>",
          stream: "GET /saudio/:videoId",
          admin: "GET /admin",
          health: "GET /health",
          version: "GET /version",
        },
      });
    } catch (e) {
      status = 500;
      console.error(`[${rid}] unhandled`, e);
      return json({ error: "internal_error" }, 500);
    } finally {
      const ms = Math.round(performance.now() - t0);
      log(rid, req.method, pathname, status, ms);
    }
  },
});

function shutdown(signal: string): void {
  console.log(`\n[${signal}] shutting down...`);
  try {
    clearInterval(cleanupTimer);
  } catch {
    /* ignore */
  }
  server.stop();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(`🐺 ${APP_NAME} v${APP_VERSION} live on http://${server.hostname}:${server.port}`);
console.log(`   ┌─ GET /info?q=<url|id>   → Track metadata`);
console.log(`   ├─ GET /saudio/:videoId  → Stream audio`);
console.log(`   ├─ GET /health           → Liveness probe`);
console.log(`   └─ GET /admin            → Health dashboard`);
