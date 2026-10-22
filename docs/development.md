# Development

## Requirements

- Windows 10/11 x64
- [Bun](https://bun.com) 1.4+ (package manager and script runner)
- Node 24.15+ only for tooling that shells out to `node`; the app runs on Electron's bundled Node

The Electron binary downloads on first run (`bunx electron --version`).

## Commands

| Command | What it does |
|---|---|
| `bun install` | Install dependencies and the git hooks (lefthook) |
| `bun run dev` | Run the hub with hot reload |
| `bunx electron-vite dev -- --server <dir>` | Run the hub with a server build instead of the installed server component or the built-in backend: it forks `<dir>/entry.js` (for example `out/server` after `bun run build:server`), with no health check or rollback. Ignored by a packaged hub |
| `bunx electron-vite dev -- --module <id>=<dir>` | Serve a module build at `/m/<id>/` instead of the installed version of that module: `<dir>` (for example the add-in's `dist/`) must hold a `manifest.xml` with a `<Version>`, its token gets every [API scope](api.md#scopes), and it gets no health check, rollback or Word registration. Repeat the flag for more modules. It needs a server with module serving (the built-in backend or `--server`). Ignored by a packaged hub |
| `bun run build` | Build main, preload and renderer into `out/` |
| `bun run start` | Run the built app |
| `bun run build:server` | Bundle the Local server into `out/server/` and install its locked production dependencies beside it, the directory the server release packs and signs ([signed releases](signed-releases.md#scripts)) |
| `bun run check` | Format check, lint, typecheck and tests — run before every push |
| `bun run test` | Unit tests (vitest) |
| `bun run addin:bundle [path]` | Builds an add-in checkout (default `../stylistic-addon`) with its `build:hub` script, or `build` when it has none, checks the build against [the add-in contract](addin-contract.md), points its manifest at the hub and copies its `dist/` into `resources/addin`, plus `Stylistic.docx`. Development only: the installer ships no add-in, and Word registers the downloaded module, not this copy; the backend still serves this folder at `https://localhost:3000` when it exists |
| `bun scripts/stage-word.ts [dir]` | Stages the Word directory into `dir` (default `out/word`, gitignored): the session loader plus its trigger document with the production add-in id, outside any content bundle. Run it once for development; `bun run dist` runs it before packaging |
| `bun run check:providers [piDir]` | Sends one small structured call to every provider signed in on this hub (default `%APPDATA%/stylistic-hub/pi`); spends a few tokens per provider |
| `bun run keys:dev` | Write development signing keys, a signed `keys.json` and an empty signed catalog to `.dev-keys/` (gitignored, overwritten on every run); production builds never trust them, and the hub does not read them yet: an unpackaged hub checks the published catalog, and there is no `--catalog <file>` flag (deferred until the manual end-to-end run) |
| `bun run test:coverage` | Tests with the coverage tiers enforced (CORE 100%, IMPORTANT 80%) |
| `bun run release:server [--no-ci] [--dry-run]` | semantic-release for the Local server: version from the commits under `src/backend/`, `src/backend/CHANGELOG.md`, tag `server-vX.Y.Z`. Releases only from `main` (stable) and `dev` (test releases, `X.Y.Z-beta.N`), per [Git Flow](git-flow.md). Steps: the `release` skill |
| `bun run release:hub [--no-ci] [--dry-run]` | semantic-release for the hub: version from all commits, `CHANGELOG.md`, builds the installer, tag `hub-vX.Y.Z`; run it after `release:server` |
| `bun run dist` | Build the unsigned per-user NSIS installer into `release/` (production): the hub and its built-in backend only, no add-in. Stages the Word loader and its trigger document with `scripts/stage-word.ts`; a stale `out/addin` is never packed |
| `bun run dist:dir` | Same packaged hub as `dist` in `release/win-unpacked/`, without the NSIS installer (~35 s instead of ~55 s); use it to try the packaged hub during development. |

## Branches

Git Flow with `dev` as the development branch and `main` for releases: [git-flow.md](git-flow.md).

## Git hooks and the dharness gate

The project uses [dharness](https://github.com/Disble/dharness) as its development harness. `dharness sync` owns `.dharness/` and the marked blocks in `eslint.config.js`; re-run it after changing tooling and to detect drift.

- `pre-commit`: `dharness check` (ESLint with the dharness rules and react-doctor on the staged change, then fallow), plus Prettier and typecheck.
- `pre-commit` also runs the coverage-tier gate: `coverage-tiers.json` classifies every file under `src/main/` and `src/renderer/` (and `src/backend/` from T2 on). New files in those folders must belong to a declared feature.
- Mutation testing: `dharness mutate <path>` once a file's tests are green.
- `commit-msg`: Conventional Commits (`feat:`, `fix:`, `docs:`…).
- `pre-push`: the test suite.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main`, `dev`, `feature/**`, `release/**` and `hotfix/**`, and on pull requests to `main` and `dev`. The dharness gate is local only (it is not built for CI); CI sets `LEFTHOOK=0` and runs the checks as steps:

- **check** (Windows): the steps of `bun run check` except coverage (`format:check`, `lint`, `typecheck`, `test`, `check:word`), then `bun run build`. The coverage tiers resolve through the dharness binary, so they are enforced by the local gate (the pre-commit coverage job and `bun run check`) and not in CI.
- **api-contract**: generates the API v1 OpenAPI document of the last `server-v*` tag and of the commit with `scripts/openapi-doc.ts` (no server is started), and runs [oasdiff](https://github.com/oasdiff/oasdiff) `breaking --fail-on ERR` on the pair. Removing a field, a route or a status from v1 fails it; additions pass. A breaking change goes in an `/api/v2` served alongside v1, never in v1. To run it locally, download oasdiff and run the same two commands the job runs.
- **release-server** and **release-hub**: only on a push to `dev` (beta prereleases) or `main` (stable), after the two checks pass. They run `release:server` and `release:hub`; semantic-release decides from the commits whether there is anything to release, pushes the release commit and tag, and creates the GitHub Release (the hub's with its installer). The hub release builds the add-in from `Disble/stylistic-addon`'s `main` and is skipped with a notice while that branch has no `build:hub`.
- **catalog-entry**: after **release-hub**, writes the released server and hub versions into `catalog/catalog.source.json` on `main` through a pull request. On `dev` the job merges it and dispatches the Catalog workflow; on `main` the pull request waits for review ([signed releases](signed-releases.md#workflows-and-urls)).

## Layout

```
src/
  main/       # Electron main process: window, tray, supervisor (desktop shell); index.ts only re-exports app.ts
  preload/    # contextBridge API exposed to the renderer as window.hub
  renderer/   # React + Fluent UI v9 screens (Home, Word, Server, Provider); main.tsx is the entry
  backend/    # local server in a utilityProcess; hexagonal, see architecture.md
  shared/     # types shared across processes
```

## Pinned toolchain

electron-vite 5 requires Vite ≤ 7, and typescript-eslint requires TypeScript < 6.1. Versions are pinned exactly in `package.json`; upgrade them together and run `bun run check`.

Build size: the renderer libraries (Fluent UI, React) are `devDependencies` because Vite bundles them into `out/renderer`; anything in `dependencies` is copied into the installer's `app.asar` as raw `node_modules` (Fluent's icon package alone is ~47,000 files). Only modules the main process or backend load at runtime belong in `dependencies`.
