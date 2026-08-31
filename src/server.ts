/**
 * server.ts - Entry point
 * Bun.serve() route dispatcher + static SPA fallback.
 * Updated: POST routes for admin actions, env config support.
 */

import { handleInfo } from "./routes/info";
import { handleSaudio } from "./routes/saudio";
import { handleAdmin } from "./routes/admin";
import { resolver } from "./core/resolver";
import { purgeExpiredStreams } from "./core/cache";
import { join } from "path";
import { existsSync, readFileSync } from "fs";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const WEB_DIST = join(import.meta.dir, "../dist/web");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function matchRoute(pathname: string): { type: string; param?: string } | null {
  if (pathname === "/info") return { type: "info" };
  if (pathname.startsWith("/saudio/")) {
    return { type: "saudio", param: pathname.slice("/saudio/".length) };
  }
  if (pathname === "/admin") return { type: "admin" };
  return null;
}

console.log("🐺 Wolfie starting up...");
await resolver.init();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const purged = purgeExpiredStreams();
  if (purged > 0) console.log(`[cleanup] Purged ${purged} expired stream URLs`);
}, 5 * 60 * 1000);

const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // ── CORS preflight (must be before API routes) ───────
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
          "Access-Control-Allow-Headers": "Range, Content-Type",
          "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
        },
      });
    }

    // ── API Routes ────────────────────────────────────────
    const route = matchRoute(pathname);
    if (route) {
      switch (route.type) {
        case "info": return handleInfo(req);
        case "saudio": return handleSaudio(req, route.param!);
        case "admin": return handleAdmin(req);
      }
    }

    // ── Static Assets ────────────────────────────────────
    let filePath = join(WEB_DIST, pathname === "/" ? "index.html" : pathname);
    if (existsSync(filePath)) {
      const ext = "." + filePath.split(".").pop();
      const mime = MIME_TYPES[ext] ?? "application/octet-stream";
      return new Response(readFileSync(filePath), {
        headers: { "Content-Type": mime, "Cache-Control": "public, max-age=31536000, immutable" },
      });
    }

    // ── SPA Fallback ─────────────────────────────────────
    const indexPath = join(WEB_DIST, "index.html");
    if (existsSync(indexPath)) {
      return new Response(readFileSync(indexPath), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // ── Fallback JSON ────────────────────────────────────
    return new Response(JSON.stringify({
      service: "Wolfie", version: "1.0.0", status: "running",
      endpoints: { info: "GET /info?q=<url|id>", stream: "GET /saudio/:videoId", admin: "GET /admin" },
    }), { headers: { "Content-Type": "application/json" } });
  },
});

console.log(`🐺 Wolfie is live on http://${server.hostname}:${server.port}`);
console.log(`   ┌─ GET /info?q=<url|id>   → Track metadata`);
console.log(`   ├─ GET /saudio/:videoId  → Stream audio`);
console.log(`   └─ GET /admin            → Health dashboard`);
