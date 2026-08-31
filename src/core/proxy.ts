/**
 * proxy.ts — smooth seek, dynamic load (YouTube Music style)
 * v2: windowed range chunking, fixed prefetch cache key, short-lived
 *     exact-range cache for scrub-back-and-forth, network-error retry.
 *
 * Public contract unchanged: same status codes, same headers exposed,
 * same call shape from routes/saudio.ts.
 */

const YT_AGENT = "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36";
import { readFileSync, watch } from "fs";
import { join } from "path";
import { createHash } from "crypto";
const COOKIE_PATH = join(import.meta.dir, "../../cookies.txt");

// ─── Cached cookie parsing (single disk read, invalidated on file change) ──
let _cookieStr = "";
let _cookieMap = new Map<string, string>();
let _cookieMtime = 0;

function reloadCookies(): void {
  try {
    const stat = require("fs").statSync(COOKIE_PATH);
    const mt = stat.mtimeMs;
    if (mt === _cookieMtime) return;
    _cookieMtime = mt;
    const raw = readFileSync(COOKIE_PATH, "utf-8");
    const pairs: string[] = [];
    const map = new Map<string, string>();
    for (const line of raw.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const p = line.split("\t");
      if (p.length >= 7) {
        pairs.push(`${p[5]}=${p[6]}`);
        map.set(p[5], p[6]);
      }
    }
    _cookieStr = pairs.join("; ");
    _cookieMap = map;
  } catch {
    _cookieStr = "";
    _cookieMap = new Map();
    _cookieMtime = 0;
  }
}

// Watch for cookie file changes (debounced)
let _cookieTimer: Timer | null = null;
try {
  watch(COOKIE_PATH, () => {
    if (_cookieTimer) clearTimeout(_cookieTimer);
    _cookieTimer = setTimeout(reloadCookies, 500);
  });
} catch {}

// Initial load
reloadCookies();

function getCookieStr(): string { reloadCookies(); return _cookieStr; }
function getCookieVal(name: string): string | null { reloadCookies(); return _cookieMap.get(name) ?? null; }

function getSapisidHash(): string | null {
  const sapisid = getCookieVal("SAPISID") || getCookieVal("__Secure-3PAPISID") || getCookieVal("__Secure-1PAPISID");
  if (!sapisid) return null;
  const ts = Math.floor(Date.now() / 1000);
  const hash = createHash("sha1").update(`${ts} ${sapisid} https://www.youtube.com`).digest("hex");
  return `${ts}_${hash}`;
}

/** Build standard YT upstream headers (cookies + SAPISIDHASH + visitor ID). */
function buildUpstreamAuth(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": YT_AGENT, ...extra };
  const cookies = getCookieStr();
  if (cookies) h["Cookie"] = cookies;
  const sh = getSapisidHash();
  if (sh) { h["Authorization"] = `SAPISIDHASH ${sh}`; h["X-Goog-AuthUser"] = "0"; }
  const vis = getCookieVal("VISITOR_INFO1_LIVE");
  if (vis) h["X-Goog-Visitor-Id"] = vis;
  return h;
}

// ─── Chunk windowing ────────────────────────────────────────────
const INITIAL_CHUNK = 512 * 1024;
const WINDOW_CHUNK = 4 * 1024 * 1024;
const MAX_CLIENT_SPAN = 8 * 1024 * 1024;

// ─── Prefetch cache ─────────────────────────────────────────────
interface PrefetchEntry {
  ts: number;
  body: ReadableStream | null;
  status: number;
  contentType: string | null;
  contentLength: string | null;
  contentRange: string | null;
}
const prefetched = new Map<string, PrefetchEntry>();
const PREFETCH_TTL = 10_000;

// ─── Short-lived exact-range cache ─────────────────────────────
interface RangeEntry { ts: number; status: number; headers: Record<string, string>; body: ArrayBuffer; }
const rangeCache = new Map<string, RangeEntry>();
const RANGE_CACHE_TTL = 8_000;
const RANGE_CACHE_MAX = 12;

function rangeCacheKey(id: string, range: string): string {
  return `${id}::${range}`;
}

function pruneRangeCache(): void {
  if (rangeCache.size <= RANGE_CACHE_MAX) return;
  let oldestKey = "";
  let oldestTs = Infinity;
  for (const [k, v] of rangeCache) {
    if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
  }
  if (oldestKey) rangeCache.delete(oldestKey);
}

function vidKey(url: string): string {
  return url.slice(-32);
}

export function prefetchStream(url: string, videoId: string): void {
  const key = videoId || vidKey(url);
  const e = prefetched.get(key);
  if (e && Date.now() - e.ts < PREFETCH_TTL) return;
  const h = buildUpstreamAuth({ Range: `bytes=0-${INITIAL_CHUNK}` });
  fetch(url, { headers: h, signal: AbortSignal.timeout(8000) })
    .then((r) => {
      if (r.ok || r.status === 206) {
        prefetched.set(key, {
          ts: Date.now(),
          body: r.body,
          status: r.status,
          contentType: r.headers.get("content-type"),
          contentLength: r.headers.get("content-length"),
          contentRange: r.headers.get("content-range"),
        });
      }
    })
    .catch(() => {});
}

function consumePrefetch(key: string): PrefetchEntry | null {
  const e = prefetched.get(key);
  if (!e) return null;
  prefetched.delete(key);
  if (Date.now() - e.ts > PREFETCH_TTL) return null;
  return e;
}

export function clearPrefetch(): number {
  const n = prefetched.size;
  prefetched.clear();
  return n;
}

function resolveWindow(clientRange: string | null): { start: number; end: number; label: string } {
  if (!clientRange) {
    return { start: 0, end: INITIAL_CHUNK, label: `bytes=0-${INITIAL_CHUNK}` };
  }
  const m = /^bytes=(\d+)-(\d*)$/i.exec(clientRange.trim());
  if (!m) return { start: -1, end: -1, label: clientRange };
  const start = parseInt(m[1], 10);
  const explicitEnd = m[2] ? parseInt(m[2], 10) : null;
  const end = explicitEnd !== null ? Math.min(explicitEnd, start + MAX_CLIENT_SPAN) : start + WINDOW_CHUNK;
  return { start, end, label: `bytes=${start}-${end}` };
}

export async function proxyStream(
  upstreamUrl: string,
  headers: Headers,
  method: string = "GET",
  videoId?: string
): Promise<Response> {
  const cacheKey = videoId || vidKey(upstreamUrl);
  const clientRangeRaw = headers.get("Range") ?? headers.get("range");

  // HEAD — instant, no body, warm prefetch
  if (method === "HEAD") {
    const existing = prefetched.get(cacheKey);
    const h = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    });
    if (existing?.contentType) h.set("Content-Type", existing.contentType);
    if (!existing) {
      const hh = buildUpstreamAuth({ Range: "bytes=0-0" });
      fetch(upstreamUrl, { headers: hh, signal: AbortSignal.timeout(5000) })
        .then((r) => r.arrayBuffer())
        .catch(() => {});
    }
    return new Response(null, { status: 200, headers: h });
  }

  const { start, end, label } = resolveWindow(clientRangeRaw);

  // Serve prefetched chunk instantly for a true first load (no Range)
  if (!clientRangeRaw) {
    const pre = consumePrefetch(cacheKey);
    if (pre) {
      const h = new Headers({
        "Accept-Ranges": "bytes",
        "Content-Type": pre.contentType || "audio/webm",
        "Cache-Control": "public, max-age=86400",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges",
      });
      if (pre.contentLength) h.set("Content-Length", pre.contentLength);
      if (pre.contentRange) h.set("Content-Range", pre.contentRange);
      return new Response(pre.body, { status: pre.status, headers: h });
    }
  }

  // Short-lived exact-range cache
  const rKey = rangeCacheKey(cacheKey, label);
  const cachedRange = rangeCache.get(rKey);
  if (cachedRange && Date.now() - cachedRange.ts < RANGE_CACHE_TTL) {
    const h = new Headers(cachedRange.headers);
    h.set("Access-Control-Allow-Origin", "*");
    return new Response(cachedRange.body.slice(0), { status: cachedRange.status, headers: h });
  }

  const upstreamHeaders = buildUpstreamAuth({
    Range: label,
    Origin: "https://www.youtube.com",
    Referer: "https://www.youtube.com/",
    Connection: "keep-alive",
    "Accept-Encoding": "identity",
  });
  const accept = headers.get("Accept");
  if (accept) upstreamHeaders["Accept"] = accept;

  const doFetch = (rangeHeader: string) => {
    const rh = { ...upstreamHeaders, Range: rangeHeader };
    return fetch(upstreamUrl, {
      method: "GET",
      headers: rh,
      keepalive: true,
      signal: AbortSignal.timeout(15000),
    } as any);
  };

  try {
    let upstream: Response;
    try {
      upstream = await doFetch(label);
    } catch {
      upstream = await doFetch(label);
    }

    if (!upstream.ok && upstream.status === 403) {
      const altStart = start >= 0 ? start : 0;
      const alt = `bytes=${altStart}-${altStart + INITIAL_CHUNK}`;
      try {
        const retry = await doFetch(alt);
        if (retry.ok || retry.status === 206) upstream = retry;
      } catch {}
    }

    if (!upstream.ok && upstream.status !== 206) {
      return new Response(JSON.stringify({ error: "upstream_stream_failed", status: upstream.status, retryable: upstream.status === 403 }), {
        status: 502,
        headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const h = new Headers({ "Accept-Ranges": "bytes" });
    for (const k of ["content-type", "content-length", "content-range", "etag", "cache-control"]) {
      const v = upstream.headers.get(k);
      if (v) h.set(k, v);
    }
    if (!h.has("content-type")) h.set("Content-Type", "audio/webm");
    h.set("Cache-Control", "public, max-age=86400");
    h.set("Access-Control-Allow-Origin", "*");
    h.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Range");
    h.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");

    const contentLength = parseInt(upstream.headers.get("content-length") ?? "", 10);
    const cacheable = upstream.body && !Number.isNaN(contentLength) && contentLength <= MAX_CLIENT_SPAN;

    if (cacheable) {
      const buf = await upstream.arrayBuffer();
      const headerObj: Record<string, string> = {};
      h.forEach((v, k) => (headerObj[k] = v));
      rangeCache.set(rKey, { ts: Date.now(), status: upstream.status, headers: headerObj, body: buf });
      pruneRangeCache();
      return new Response(buf, { status: upstream.status, headers: h });
    }

    return new Response(upstream.body, { status: upstream.status, headers: h });
  } catch {
    return new Response(JSON.stringify({ error: "upstream_fetch_failed" }), {
      status: 502,
      headers: { "content-type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
}
