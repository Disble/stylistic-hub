# Hub port off the development defaults

Move the hub's fixed HTTPS port from 3000 to 41730 so it never shadows development servers (Next, webpack-dev-server).
Cross-project: the hub (this repo) and `stylistic-addon` (manifest origin of the signed module). Branches: hub `feature/hub-port` from `dev`; addon `feat/hub-port`.

## Specs

- **S1** — "esta mal que el hub ocupe cualquiera de los puertos estandar de desarrollo". The hub's backend listens on `https://localhost:41730` (`127.0.0.1` and `::1`), never on 3000. Every hub-side origin derives from one constant (`HUB_PORT` in `src/shared/versions.ts`): server address shown in the renderer, health and status requests, Host/CORS allowlists, the add-in bundle origin (`scripts/addin-bundle-contract.ts` `HUB_ORIGIN`), renderer fallbacks.
- **S2** — The port stays fixed (Word registers the manifest with fixed URLs and Office caches them); 41730 is below the Windows ephemeral range (49152+) and outside this machine's excluded port ranges.
- **S3** — User decision: "El hub reescribe el origen". A module already published with manifest URLs under `https://localhost:3000/` keeps working: after its signature is verified, when the hub writes the manifest it registers in Word (the stable `components/<id>/manifest.xml`), the origin `https://localhost:3000` is replaced with the hub origin. A manifest that already names the hub origin is left as is. Signature verification still runs on the original bytes.
- **S4** — `bun run addin:bundle` points a bundled manifest at the new origin (a manifest naming `https://localhost:3000` is rewritten like any other origin).
- **S5** — The add-in's own build and release target the new origin: in `stylistic-addon`, the module build (`build:module`) and the hub build (`build:hub`) write `https://localhost:41730/` (module under `/m/stylistic-word-addin/`); the add-in's own dev server stays on 3000 (`bun run dev-server`, `manifest.xml` source). The release workflow check and the release skill name the new origin.
- **S6** — Docs that describe the port (hub `docs/architecture.md`, `docs/addin-contract.md`, `docs/development.md`, release skill; addon `docs/api-contract.md`, README if it describes the hub origin) say 41730. Historical `odd/tasks/*` logs and research reports are not rewritten.

## Tasks

| ID | Specs | Route | Status | Commit |
| --- | --- | --- | --- | --- |
| T1 | S1-S4, S6 (hub) | inline (worker unavailable) | done | see L5 |
| T2 | S5, S6 (addon) | inline | done | stylistic-addon `feat/hub-port`, see L4 |

## Log

- **L1** (2026-11-23, user request, verbatim): "necesito que me ayudes con esto, esta mal que el hub ocupe cualquiera de los puertos estandar de desarrollo" — with a capture: Next `yarn dev` on `0.0.0.0:3000` was shadowed by `Stylistic Hub.exe` listening on `127.0.0.1:3000` and `[::1]:3000` (Windows prefers the specific-address bind), so `localhost:3000` reached the hub.
- **L2** (decisions): port 41730 (recommended option); legacy modules: "El hub reescribe el origen" (recommended option).
- **L3** (evidence): `netsh int ipv4 show excludedportrange protocol=tcp` excludes 80, 5357, 13508, 27339, 49682-50300, 53757-53856, 61633-61732; dynamic range 49152-65535.
- **L4** (T2): `scripts/release/addinManifest.cjs` gains `HUB_BASE_URL = https://localhost:41730/`; `MODULE_BASE_URL` derives from it; a rewrite now also moves bare origins (`SupportUrl`, `AppDomain`), which before stayed on 3000 in module builds. `webpack.config.js`: `--env hub` uses `HUB_BASE_URL`, dev keeps 3000. Release workflow check, release skill, README, `docs/api-contract.md` updated. RED 2/4, GREEN 4/4; full suite 555/555; eslint 0 errors (2 pre-existing unused-directive warnings). No `build:module` run (workspace rule: no builds unless asked).
- **L5** (T1): the gentle-ai-worker was unavailable (no changes left) and was not retried; done inline. `src/shared/hub-origin.ts` (`HUB_PORT = 41730`, `HUB_ORIGIN`, `pointAtHub`) replaces `HUB_PORT` in `versions.ts`; `app.ts` and `scripts/addin-bundle-contract.ts` use it; `module-switch.ts` writes the stable manifest through `pointAtHub` (signed copy untouched). S3 narrowed: the backend keeps serving `/m/<id>/manifest.xml` as signed, since Word reads the stable file and the health check only needs 200. Word: `word-integration.ts` `sync` re-registers a module whose stable manifest hash changed, so an existing install is re-registered on the next start; whether Office drops its cached copy of the old URLs is not verified on a real Word. Renderer fallbacks, fixtures, docs and the release skill say 41730. RED 5 (plus missing module), GREEN 47/47.
