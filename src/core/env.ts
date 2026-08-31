/**
 * env.ts - Shared .env file parser
 * Used by info.ts and admin.ts to avoid duplication.
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ENV_PATH = join(import.meta.dir, "../../.env");

export function readEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(ENV_PATH)) return env;
  for (const line of readFileSync(ENV_PATH, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

export function writeEnv(env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf-8");
}

export function buildStreamProxyUrl(videoId: string, host: string | null, proto: string | null): { streamUrl: string; proxyUrl: string } {
  const env = readEnv();
  const addressUrl = env.ADDRESS_URL;
  let streamUrl = `/saudio/${videoId}`;
  if (addressUrl && addressUrl !== "localhost" && addressUrl !== "0.0.0.0") {
    streamUrl = `${addressUrl.replace(/\/$/, "")}/saudio/${videoId}`;
  }
  const h = host ?? "localhost:3000";
  const p = proto ?? "http";
  return { streamUrl, proxyUrl: `${p}://${h}/saudio/${videoId}` };
}
