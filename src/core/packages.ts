/**
 * packages.ts - Package manager: list, check updates, update
 */

import { readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";

const PROJECT_ROOT = join(import.meta.dir, "../..");

export interface PkgInfo {
  name: string;
  current: string;
  latest: string;
  isOutdated: boolean;
  isDev: boolean;
}

let cachedPackages: PkgInfo[] | null = null;
let cacheTs = 0;
const CACHE_TTL = 30_000;

export async function listPackages(force = false): Promise<PkgInfo[]> {
  if (!force && cachedPackages && Date.now() - cacheTs < CACHE_TTL) return cachedPackages;

  const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
  const allDeps: Record<string, string> = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const devDeps = new Set(Object.keys(pkgJson.devDependencies ?? {}));

  const ls = await $`bun pm ls 2>&1`.cwd(PROJECT_ROOT).text();
  const installed = new Map<string, string>();
  for (const line of ls.split("\n")) {
    const m = line.match(/[├└]──\s+(@?[^@\s]+)@([\d.]+\S*)/);
    if (m) installed.set(m[1], m[2]);
  }

  // Fetch latest versions from npm registry in parallel
  const packages: PkgInfo[] = [];
  const fetches = Object.entries(allDeps).map(async ([name, _range]) => {
    const current = installed.get(name) ?? "0.0.0";
    let latest = current;
    try {
      const res = await fetch(`https://registry.npmjs.org/${name}/latest`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        latest = data.version ?? current;
      }
    } catch {}
    return { name, current, latest, isOutdated: current !== latest, isDev: devDeps.has(name) };
  });

  const results = await Promise.all(fetches);
  results.sort((a, b) => a.name.localeCompare(b.name));
  cachedPackages = results;
  cacheTs = Date.now();
  return results;
}

export async function updatePackages(packages?: string[]): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = [];
  const failed: string[] = [];

  if (packages && packages.length > 0) {
    // Update specific packages one by one
    for (const pkg of packages) {
      try {
        const result = await $`bun update ${pkg} 2>&1`.cwd(PROJECT_ROOT).text();
        if (result.includes("error") || result.includes("ERR")) {
          failed.push(pkg);
        } else {
          success.push(pkg);
        }
      } catch {
        failed.push(pkg);
      }
    }
  } else {
    // Update all
    try {
      const result = await $`bun update 2>&1`.cwd(PROJECT_ROOT).text();
      // Parse which packages were updated
      const updated = result.match(/\^ ([\w/@-]+)\s+([\d.]+)\s+->\s+([\d.]+)/g);
      if (updated) {
        for (const u of updated) {
          const m = u.match(/([\w/@-]+)\s+([\d.]+)\s+->\s+([\d.]+)/);
          if (m) success.push(m[1]);
        }
      }
      if (success.length === 0 && !result.includes("error")) {
        success.push("all");
      }
    } catch {
      failed.push("all");
    }
  }

  // Invalidate cache
  cachedPackages = null;
  cacheTs = 0;

  return { success, failed };
}
