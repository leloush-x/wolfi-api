# 🐺 Wolfie — YouTube Audio API + Dashboard

Fast, stable YouTube audio metadata + streaming proxy powered by **InnerTube MWEB**
(`youtubei.js`), served by **Bun** with a built-in React dashboard.

- `GET /info?q=<url|id>` → track metadata (cached 7 days)
- `GET /saudio/:videoId` → seekable audio proxy (windowed ranges, prefetch)
- `GET /admin` → health dashboard data · `POST /admin` → cache / cookies / env / packages
- `GET /health` → liveness probe · `GET /version` → version

## Why it's fast under load

| Technique | Where |
|---|---|
| **Single-flight** — N concurrent same-ID requests share 1 YouTube fetch | `src/core/singleflight.ts`, `resolver.ts`, routes |
| **Concurrency cap** — max 4 parallel InnerTube calls, rest queue (no 429 self-DDoS) | `resolver.ts` (`YT_MAX_CONCURRENT`) |
| **Stale-while-revalidate** — slightly-expired URLs play instantly, refresh in background | `cache.ts` (`getStaleStream`), `saudio.ts` |
| **Zero-copy statics** — `Bun.file()` streaming, no blocking `readFileSync` on hot paths | `server.ts` |
| **mtime-cached config/cookies** — no disk I/O per request | `env.ts`, `cookies.ts` |
| **Backoff retries** — transient upstream failures retry once with jitter, not hot loops | `proxy.ts`, `singleflight.ts` |

Idle is light too: polling pauses when the tab hides, the starfield canvas sleeps,
and the cleanup timer is `unref`'d.

## Quick start

```bash
bun install
bun run src/server.ts        # API on http://0.0.0.0:3000
```

Dashboard is served from the same port (open `/` in a browser).
For frontend dev with HMR:

```bash
bun run dev:client            # vite, proxies /info /saudio /admin → :3000
```

## Configuration

Environment variables win over the `.env` file (which also supports the legacy
`.env.` filename found on older installs):

| Key | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `ADDRESS_URL` | _(empty)_ | Public base URL used in `streamUrl` (e.g. `https://api.example.com`) |
| `ADMIN_TOKEN` | _(empty)_ | When set, locks `/admin` (GET status + all POST actions) behind `Authorization: Bearer <token>` or `?token=`. The dashboard has a token field (kept in sessionStorage only). |

`cookies.txt` (Netscape format, optional but recommended) improves YouTube
reliability. Upload it from Admin → Cookie Management, or place it next to
`.env`. The session resets automatically on upload.

## API reference

### `GET /info?q=<url|id>`

Accepts raw IDs, `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`, `/v/`,
and YouTube Music links.

```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "…", "channel": "…",
  "duration": 212, "durationFormatted": "3:32",
  "thumbnail": "https://…",
  "ytLink": "https://www.youtube.com/watch?v=…",
  "streamUrl": "/saudio/dQw4w9WgXcQ",
  "proxyUrl": "http://host:3000/saudio/dQw4w9WgXcQ",
  "cached": true
}
```

Errors: `400` missing/unparsable `q`, `502` unresolvable video.

### `GET /saudio/:videoId`

Streams audio with full Range support (seek/scrub). Variants:

- `GET /saudio/:id?json` (or `Accept: application/json`) → JSON with
  `streamUrl`, `proxyUrl`, `expiresAt`, `expiresIn`, `cached`
- `GET /saudio/:id?redirect` → `302` to the upstream URL
- `HEAD /saudio/:id` → instant headers, warms prefetch

### `GET /admin` / `POST /admin`

GET returns `{ service, version, auth, system, session, requests, inflight,
latency, cache, config, timestamp }`. Uptime renders as `45s` → `12m 30s` →
`5h 12m` → `2d 5h 12m`, plus `uptimeSeconds` and `startedAt`.

POST actions (`{ action, … }`): `toggle_cache`, `flush_cache`,
`purge_expired`, `upload_cookies`, `get_config`, `update_env`,
`list_packages`, `update_packages`. Package names and env keys are strictly
validated; `ADMIN_TOKEN` can never be changed via the API.

## Project layout

```
src/
  server.ts          entry — routing, zero-copy statics, graceful shutdown
  core/
    constants.ts     single source of truth (TTLs, limits, MIME, CORS, paths)
    http.ts          json/cors/errors, formatBytes, formatUptime
    singleflight.ts  dedupe + semaphore + backoff retry
    cookies.ts       centralized cookies.txt (mtime-throttled, watched)
    env.ts           .env parser (mtime-cached, process.env wins)
    cache.ts         SQLite WAL: metadata (7d) + streams (3h cap, SWR 10m)
    resolver.ts      InnerTube MWEB singleton (single-flight + capped)
    extractor.ts     URL/ID → canonical 11-char videoId
    metadata.ts      TrackInfo + formatDuration
    packages.ts      npm list/update (capped, validated)
    proxy.ts         range-windowed audio proxy + prefetch
  routes/            info.ts, saudio.ts, admin.ts (thin handlers)
client/src/
  App.tsx            tabs · pages/  Dashboard, ApiGround, Admin
  components/        UI kit, Charts (zero-dep SVG), PackageManager, StarCanvas
  hooks/             useApi (abortable, visibility-aware), useCopy
  utils/             format (duration), auth (admin token)
```

## Scripts

| Command | Purpose |
|---|---|
| `bun run src/server.ts` (`start`) | Run API + dashboard |
| `bun run dev` / `dev:client` | Hot backend / Vite frontend |
| `bun run build` | Build dashboard into `dist/web` |
| `bun run typecheck` | Server + client typecheck |
| `bun run lint` | oxlint |
| `bash deploy.sh` | Rebuild `dist/`, commit, push |

`dist/` is rebuilt automatically by CI on every push touching `client/**`.

## Security notes

- Set `ADMIN_TOKEN` on any public deployment — otherwise admin actions are open.
- `config` in `/admin` responses redacts `*TOKEN*/*SECRET*/*KEY*/*COOKIE*` values.
- Cookies and `.env*` / `*.sqlite` are gitignored (note: `.env.` is still
  tracked historically — it only holds non-secret defaults).
