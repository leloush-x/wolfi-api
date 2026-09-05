/**
 * http.ts — shared HTTP helpers. Single definition of json()/CORS/errors.
 * All routes import from here instead of redefining their own copy.
 */

import { CORS_API } from "./constants";

let reqSeq = 0;
export function nextRequestId(): string {
  reqSeq = (reqSeq + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${reqSeq.toString(36)}`;
}

export function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_API, ...extra },
  });
}

export function jsonPretty(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_API,
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export function err(code: string, status = 500, detail?: string): Response {
  return json(detail ? { error: code, detail } : { error: code }, status);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: { ...CORS_API } });
}

/** Allow only listed methods; otherwise 405 with an Allow header. */
export function requireMethod(req: Request, allowed: string[]): Response | null {
  if (allowed.includes(req.method)) return null;
  return new Response(JSON.stringify({ error: "method_not_allowed", allow: allowed }), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      ...CORS_API,
      Allow: allowed.join(", "),
    },
  });
}

export function log(rid: string, method: string, path: string, status: number, ms: number): void {
  if (status >= 500) console.error(`[${rid}] ${method} ${path} → ${status} (${ms}ms)`);
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/** Human uptime: "45s" → "12m 30s" → "5h 12m" → "2d 5h 12m". */
export function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
