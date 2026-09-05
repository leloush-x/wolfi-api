/**
 * env.ts — .env file parser with mtime cache.
 * Fixes: old code only looked at "../../.env" while installs on disk use
 * ".env." (trailing dot), so ADDRESS_URL was silently ignored. It also did
 * a disk read on EVERY /info request.
 *
 * - Tries ENV_PATHS in order (.env, then legacy .env.)
 * - Caches parsed result, re-reads only when mtime changes
 * - process.env always wins over file values
 */

import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { ENV_PATHS } from "./constants";

let cache: Record<string, string> | null = null;
let cacheMtime = 0;
let cachePath = "";

function activePath(): string | null {
  for (const p of ENV_PATHS) {
    try {
      if (existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function parseFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

export function readEnv(): Record<string, string> {
  const path = activePath();
  if (path) {
    try {
      const mt = statSync(path).mtimeMs;
      if (!cache || cachePath !== path || mt !== cacheMtime) {
        cache = parseFile(path);
        cacheMtime = mt;
        cachePath = path;
      }
    } catch {
      cache = cache ?? {};
    }
  } else if (!cache) {
    cache = {};
  }
  // process.env overrides file (12-factor). Only string values.
  const out: Record<string, string> = { ...cache };
  for (const k of Object.keys(out)) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  // Also surface PORT/HOST/ADDRESS_URL/ADMIN_TOKEN from process env even if absent in file.
  for (const k of ["PORT", "HOST", "ADDRESS_URL", "ADMIN_TOKEN"]) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export function writeEnv(env: Record<string, string>): void {
  const path = activePath() ?? ENV_PATHS[0];
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, lines.join("\n") + "\n", "utf-8");
  cache = { ...env };
  try {
    cacheMtime = statSync(path).mtimeMs;
  } catch {
    cacheMtime = 0;
  }
  cachePath = path;
}

/** Load file values into process.env (only for keys not already set). Call once at boot. */
export function loadEnvIntoProcess(): void {
  const file = (() => {
    const p = activePath();
    if (!p) return {};
    try {
      return parseFile(p);
    } catch {
      return {};
    }
  })();
  for (const [k, v] of Object.entries(file)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function getPort(): number {
  const raw = process.env.PORT ?? readEnv().PORT ?? "3000";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 3000;
}

export function getHost(): string {
  return process.env.HOST ?? readEnv().HOST ?? "0.0.0.0";
}

export function buildStreamProxyUrl(
  videoId: string,
  host: string | null,
  proto: string | null,
): { streamUrl: string; proxyUrl: string } {
  const env = readEnv();
  const addressUrl = (env.ADDRESS_URL ?? "").trim();
  let streamUrl = `/saudio/${videoId}`;
  if (addressUrl && addressUrl !== "localhost" && addressUrl !== "0.0.0.0") {
    streamUrl = `${addressUrl.replace(/\/$/, "")}/saudio/${videoId}`;
  }
  const h = host ?? "localhost:3000";
  const p = proto ?? "http";
  return { streamUrl, proxyUrl: `${p}://${h}/saudio/${videoId}` };
}
