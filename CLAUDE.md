# PDX Trees — Agent Guide

Personal tree atlas: the owner catalogs the trees visible from their window. Live at **https://rachel-howell.github.io/pdxtrees/** (this repo is public — code only, never data). Built collaboratively with Claude across several sessions in July 2026.

**Privacy is the load-bearing requirement.** Pinned trees reveal where the owner lives. Every feature must default closed. When in doubt, choose the more private option and surface the tradeoff to the owner.

## Architecture

- **Vite + React 19 + TypeScript** SPA. No router — deep links are hash-based (`#/tree/<uuid>`), parsed in `App.tsx`.
- **Leaflet + react-leaflet v5.** Satellite = OSIP 2022 (Oregon's public leaf-on aerial imagery, the whole point — tree crowns are distinguishable) layered **over** Esri World Imagery (shows through outside Oregon). Vite `base` is `/pdxtrees/`; the dev server serves at `localhost:5173/pdxtrees/`.
- **Supabase is the source of truth** (project `qbjpcrubwbxywbuppfuq`): Postgres + Storage bucket `tree-photos`. The publishable key in `src/supabase.ts` is committed on purpose (client-side by design); RLS is the security boundary.
- **All persistence goes through `src/db.ts`** (repository pattern, snake_case rows ↔ camelCase via `fromRow`/`toRow`). Components never import supabase directly. This seam has survived one full backend swap (IndexedDB → Supabase); keep it clean.
- **Auth:** magic-link only; **signups disabled server-side**; there is exactly one account (the owner's). Logged-out visitors get a read-only map of effectively-public trees.
- **Deploy:** GitHub Pages via Actions on push to `main` (`.github/workflows/deploy.yml`).

## Data model & privacy rules

- `trees`: common_name (may be `''` — see status), nickname, species, date_encountered, notes, `confidence` (high/medium/low), `status` (spotted/guessed/confirmed — drives pin color: grey/yellow/green), `location_label` ("SW Park Ave & SW Salmon St"), lat/lng, `is_public` (default false).
- `profiles.account_private` (default **true**) — master switch that **overrides** per-tree `is_public`. Effective visibility = `is_public AND NOT account_private`, enforced in RLS via security-definer `tree_visible()` (needed because anon can't read others' profiles rows). Storage object policies mirror this for photos.
- `photos`: rows in Postgres, blobs at `{uid}/{treeId}/{photoId}.jpg`.
- `views` + `view_markers` (window photos with markers linking to trees): **owner-only, no anon grants at all, never make these public** — a window photo reveals the exact viewpoint. Images at `{uid}/views/{viewId}.jpg`, where the public-read storage policy structurally can't match.
- A private tree fetched via deep link must stay **indistinguishable from a nonexistent one** (same message for both). Don't leak existence.
- Export/import: JSON with base64 photos, merge-by-id (existing wins). Old backups lack newer fields — `importRecords` defaults them (`status→'guessed'`, `isPublic→false`, etc.). Views are NOT in exports (known gap).

## External services (all free, all validated)

- **OSIP imagery**: `imagery.oregonexplorer.info/.../OSIP_2022/OSIP_2022_WM/ImageServer/tile/{z}/{y}/{x}`, maxNativeZoom 19. **Gotcha:** OSIP_2024_WM exists but uses a nonstandard tile origin — unusable as a plain TileLayer; check the `tileInfo.origin` before upgrading vintages.
- **Nominatim** (search + reverse): search-on-submit only — their policy forbids autocomplete. The `viewbox` bias to the current map view is essential for short queries.
- **Overpass** (cross-street lookup in `src/geo.ts`): finds the nearest node shared by ≥2 differently-named ways within 120m. Rate-limits bursts → one built-in retry. Returns 406 to curl's default User-Agent (browsers are fine).
- Reverse geocoding sends bare lat/lng to OSM — the owner accepted this tradeoff explicitly (for tree labels only).

## Gotchas that actually bit us

1. **Dates:** always `new Date().toLocaleDateString('en-CA')`, never `toISOString().slice(0,10)` — Portland evenings are already tomorrow in UTC. This shipped as a bug twice (default date + export filename).
2. **`input[hidden]`:** our CSS sets `display:block` on inputs, which beats the UA `[hidden]` rule. A global `input[hidden]{display:none!important}` fix exists in `index.css` — this regressed once when a new hidden file input was added outside `.tree-form`.
3. **Deep-link race:** `pendingDeepLink` ref in `App.tsx` is captured at first render because the hash-sync effect would otherwise clear `#/tree/…` before the async resolver runs on a cold page load (QR scans!). Only reproducible on real page loads, not SPA hash navigation — test with a hard reload.
4. **GitHub Pages deploys fail transiently** ("Deployment failed, try again later") every few days. Do **not** `gh run rerun` — it duplicates the `github-pages` artifact and fails differently. Wait ~4 minutes, then `gh workflow run deploy.yml`. githubstatus.com often shows green during these.
5. **Supabase Management API** (`POST /v1/projects/{ref}/database/query`): tables created this way get **no role grants** — grant explicitly to `anon`/`authenticated` as appropriate (RLS still applies on top). PostgREST reports ungranted tables as "not in schema cache", which usefully hides their existence from anon.
6. **Supabase keys:** new-style `sb_publishable_`/`sb_secret_` keys. The publishable key gets 401 on the OpenAPI root (secret-only endpoint) — normal queries work; don't chase that 401. Admin operations: reveal the secret key via `GET /v1/projects/{ref}/api-keys?reveal=true` with a PAT, use transiently, never store. Magic links can be minted with `POST {project}/auth/v1/admin/generate_link` (the `redirect_to` must be in the auth `uri_allow_list`: prod URL + `http://localhost:5173/pdxtrees/`).
7. **Supabase free tier pauses after ~1 week idle** — if the app errors after an absence, unpause in the dashboard.
8. **iOS specifics:** global `user-select:none` (re-enabled for inputs/notes) because long-press triggered the text callout; date inputs need `appearance:none` or they force horizontal scroll; file inputs must NOT have `capture` (it blocks photo-library selection).
9. **react-leaflet v5:** swapping a `TileLayer`'s URL needs a `key` prop; `MapContainer` `ref` gives the `L.Map`. Window-view viewer uses `CRS.Simple` + `ImageOverlay` with marker latlng = `[-y*h, x*w]` (fractional coords stored 0–1).

## Working conventions

- **Verify like it's production, because it is** — the owner's real data lives in the prod DB. Create clearly-labeled test records, exercise the real UI via the Chrome extension, then delete them and confirm zero orphans (DB rows AND storage objects). After any schema/RLS change, verify the anon lockout from outside with curl.
- Browser automation can't drive native file dialogs — inject a `File` via `DataTransfer` on the input and dispatch a `change` event. Never use `window.confirm` in app code (blocks the extension; the app uses inline two-step confirms). `jsqr` is a devDependency for decoding generated QR codes in-page (importable in dev via `/pdxtrees/@fs/...`).
- Typecheck (`npx tsc --noEmit`) + build before committing; commit messages explain the why; pushing `main` deploys. Confirm the deploy concluded `success` and spot-check the live site (anon sees nothing private).
- The owner approves plans first for non-trivial work, likes crisp option questions, and reports precise bug feedback — take repro details literally, and say plainly what was verified vs. assumed.
