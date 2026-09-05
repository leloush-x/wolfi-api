# Wolfie Dashboard (client)

React 19 + Vite dashboard served by the Wolfie API itself (`dist/web`).
See the **root `README.md`** for the full project docs.

## Develop

```bash
# from repo root
bun run dev:client     # HMR on :5173, proxies /info /saudio /admin → :3000
bun run src/server.ts  # API in another terminal
```

## Structure

```
src/
  App.tsx            tab shell (Dashboard / API Ground / Admin)
  pages/             route views
  components/        UI kit · Charts (dependency-free SVG) ·
                     PackageManager · StarCanvas (twinkle + meteors)
  hooks/             useApi (abortable fetch, pauses when tab hidden)
                     useCopy (clipboard + fallback)
  utils/             format (duration) · auth (admin token, sessionStorage)
  index.css          design system (tokens → components → responsive)
```

## Notes

- No chart library — `Charts.tsx` renders lightweight inline SVG.
- Polling (`useAdmin`) stops when the tab is hidden and aborts in-flight
  requests on unmount.
- Canvas honors `prefers-reduced-motion` (single static frame, no loop).
- `bun run build` (from root) emits to `../dist/web`; CI rebuilds it on push.
