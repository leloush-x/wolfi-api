/**
 * cookies.ts — ONE place that reads cookies.txt.
 * Previously resolver.ts and proxy.ts each parsed the file themselves,
 * and proxy.ts did a blocking statSync on EVERY proxied chunk.
 *
 * This module: mtime-throttled cache (max 1 stat/sec) + fs.watch invalidation.
 */

import { readFileSync, statSync, watch, writeFileSync } from "fs";
import { createHash } from "crypto";
import { COOKIE_PATH } from "./constants";

let cookieStr = "";
let cookieMap = new Map<string, string>();
let cookieMtime = 0;
let lastCheck = 0;
let cookieCount = 0;

const CHECK_THROTTLE_MS = 1_000;

function parse(raw: string): void {
  const pairs: string[] = [];
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const p = line.split("\t");
    if (p.length >= 7) {
      pairs.push(`${p[5]}=${p[6]}`);
      map.set(p[5], p[6]);
    }
  }
  cookieStr = pairs.join("; ");
  cookieMap = map;
  cookieCount = pairs.length;
}

export function reloadCookies(force = false): void {
  const now = Date.now();
  if (!force && now - lastCheck < CHECK_THROTTLE_MS) return;
  lastCheck = now;
  try {
    const mt = statSync(COOKIE_PATH).mtimeMs;
    if (mt === cookieMtime) return;
    cookieMtime = mt;
    parse(readFileSync(COOKIE_PATH, "utf-8"));
  } catch {
    cookieStr = "";
    cookieMap = new Map();
    cookieMtime = 0;
    cookieCount = 0;
  }
}

// Invalidate immediately on file change (debounced).
let timer: ReturnType<typeof setTimeout> | null = null;
try {
  watch(COOKIE_PATH, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => reloadCookies(true), 300);
    if (typeof timer === "object" && "unref" in timer) (timer as any).unref?.();
  });
} catch {
  /* cookies.txt may not exist on first boot */
}

reloadCookies(true);

export function getCookiePath(): string {
  return COOKIE_PATH;
}

export function setCookiePath(_p: string): void {
  // Kept for backwards compat — path is now centralized in constants.ts.
  console.warn("[cookies] setCookiePath() is deprecated; path is centralized in constants.ts");
}

export function isCookieFileValid(): boolean {
  reloadCookies();
  return cookieCount > 0;
}

export function getCookieInfo(): { loaded: boolean; cookieCount: number; path: string } {
  reloadCookies();
  return { loaded: cookieCount > 0, cookieCount, path: COOKIE_PATH };
}

export function getCookieHeader(): string | undefined {
  reloadCookies();
  return cookieStr ? cookieStr : undefined;
}

export function getCookieVal(name: string): string | null {
  reloadCookies();
  return cookieMap.get(name) ?? null;
}

export function saveCookies(content: string): boolean {
  try {
    writeFileSync(COOKIE_PATH, content, "utf-8");
    reloadCookies(true);
    return true;
  } catch {
    return false;
  }
}

export function getSapisidHash(): string | null {
  const sapisid =
    getCookieVal("SAPISID") || getCookieVal("__Secure-3PAPISID") || getCookieVal("__Secure-1PAPISID");
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const hash = createHash("sha1").update(`${ts} ${sapisid} https://www.youtube.com`).digest("hex");
  return `${ts}_${hash}`;
}
