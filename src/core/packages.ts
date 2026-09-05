/**
 * packages.ts - Package manager: list, check updates, update
 * Hardened: single-flight list (no npm stampede), capped npm concurrency,
 * strict name validation (no shell injection via admin API).
 */

import { readFileSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { NPM_TIMEOUT_MS, PKG_LIST_TTL_MS } from "./constants";
import { createLimiter, singleflight } from "./singleflight";

const PROJECT_ROOT = join(import.meta.dir, "../..");
const PKG_NAME_RE = /^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const npmLimiter = createLimiter(6);

export interface PkgInfo {
  name: string;
  current: string;
  latest: string;
  isOutdated: boolean;
  isDev: boolean;
}

let cachedPackages: PkgInfo[] | null = null;
let cacheTs = 0;

export async function listPackages(force = false): Promise<PkgInfo[]> {
  if (!force && cachedPackages && Date.now() - cacheTs < PKG_LIST_TTL_MS) return cachedPackages;
  // Concurrent admin clicks / dashboards share one computation + npm burst.
  return singleflight("pkg:list", async () => {
    if (!force && cachedPackages && Date.now() - cacheTs < PKG_LIST_TTL_MS) return cachedPackages;

    const pkgJson = JSON.parse(readFileSync(join(PROJECT_ROOT, "package.json"), "utf-8"));
    const allDeps: Record<string, string> = {
      ...pkgJson.dependencies,
      ...pkgJson.devDependencies,
    };
    const devDeps = new Set(Object.keys(pkgJson.devDependencies ?? {}));

    const ls = await $`bun pm ls 2>&1`.cwd(PROJECT_ROOT).text();
    const installed = new Map<string, string>();
    for (const line of ls.split("\n")) {
      const m = line.match(/[├└]──\s+(@?[^@\s]+)@([\d.]+\S*)/);
      if (m) installed.set(m[1], m[2]);
    }

    const fetches = Object.entries(allDeps).map(([name]) =>
      npmLimiter.run(async (): Promise<PkgInfo> => {
        const current = installed.get(name) ?? "0.0.0";
        let latest = current;
        try {
          const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
            signal: AbortSignal.timeout(NPM_TIMEOUT_MS),
          });
          if (res.ok) {
            const data = (await res.json()) as any;
            latest = data.version ?? current;
          }
        } catch {
          /* offline → treat as up-to-date */
        }
        return { name, current, latest, isOutdated: current !== latest, isDev: devDeps.has(name) };
      }),
    );

    const results = await Promise.all(fetches);
    results.sort((a, b) => a.name.localeCompare(b.name));
    cachedPackages = results;
    cacheTs = Date.now();
    return results;
  });
}

function assertSafeName(pkg: string): void {
  if (!PKG_NAME_RE.test(pkg)) throw new Error(`Unsafe package name: ${pkg}`);
}

export async function updatePackages(packages?: string[]): Promise<{ success: string[]; failed: string[] }> {
  const success: string[] = [];
  const failed: string[] = [];

  if (packages && packages.length > 0) {
    const names = [...new Set(packages)].slice(0, 50);
    try {
      names.forEach(assertSafeName);
    } catch {
      return { success, failed: names };
    }
    for (const pkg of names) {
      try {
        const result = await $`bun update ${pkg} 2>&1`.cwd(PROJECT_ROOT).text();
        if (result.includes("error") || result.includes("ERR")) failed.push(pkg);
        else success.push(pkg);
      } catch {
        failed.push(pkg);
      }
    }
  } else {
    try {
      const result = await $`bun update 2>&1`.cwd(PROJECT_ROOT).text();
      const updated = result.match(/\^ ([\w/@-]+)\s+([\d.]+)\s+->\s+([\d.]+)/g);
      if (updated) {
        for (const u of updated) {
          const m = u.match(/([\w/@-]+)\s+([\d.]+)\s+->\s+([\d.]+)/);
          if (m) success.push(m[1]);
        }
      }
      if (success.length === 0 && !result.includes("error")) success.push("all");
    } catch {
      failed.push("all");
    }
  }

  cachedPackages = null;
  cacheTs = 0;

  return { success, failed };
}
