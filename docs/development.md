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
| `bun run build` | Build main, preload and renderer into `out/` |
| `bun run start` | Run the built app |
| `bun run check` | Format check, lint, typecheck and tests — run before every push |
| `bun run test` | Unit tests (vitest) |
| `bun run addin:bundle [path]` | Builds an add-in checkout (default `../stylistic-addon`) with its `build:hub` script, or `build` when it has none, checks the build against [the add-in contract](addin-contract.md), points its manifest at the hub and copies its `dist/` into `resources/addin`, plus `Stylistic.docx`, the document `word-session.ps1` shows Word once per session so Word loads the add-in, which the hub serves at `https://localhost:3000` and registers with Word |
| `bun run check:providers [piDir]` | Sends one small structured call to every provider signed in on this hub (default `%APPDATA%/stylistic-hub/pi`); spends a few tokens per provider |
| `bun run test:coverage` | Tests with the coverage tiers enforced (CORE 100%, IMPORTANT 80%) |
| `bun run release:server [--no-ci] [--dry-run]` | semantic-release for the Local server: version from the commits under `src/backend/`, `src/backend/CHANGELOG.md`, tag `server-vX.Y.Z`. Releases only from semantic-release's default branches: `main`/`master`, `next`, `next-major`, `N.x`, and `beta`/`alpha` for test releases (`X.Y.Z-beta.N`). Steps: the `release` skill |
| `bun run release:hub [--no-ci] [--dry-run]` | semantic-release for the hub: version from all commits, `CHANGELOG.md`, builds the installer, tag `hub-vX.Y.Z`; run it after `release:server` |
| `bun run dist` | Build the unsigned per-user NSIS installer into `release/` (production): it packs a copy of `resources/addin` staged in `out/addin` under the production add-in id, so the installed hub never shares Word's sideload entry, or the debugger flags `npm start` sets on it, with development; needs `bun run addin:bundle` first and stops if `resources/addin` is missing |
| `bun run dist:dir` | Same packaged hub as `dist` in `release/win-unpacked/`, without the NSIS installer (~35 s instead of ~55 s); use it to try the packaged hub during development. |

## Git hooks and the dharness gate

The project uses [dharness](https://github.com/Disble/dharness) as its development harness. `dharness sync` owns `.dharness/` and the marked blocks in `eslint.config.js`; re-run it after changing tooling and to detect drift.

- `pre-commit`: `dharness check` (ESLint with the dharness rules and react-doctor on the staged change, then fallow), plus Prettier and typecheck.
- `pre-commit` also runs the coverage-tier gate: `coverage-tiers.json` classifies every file under `src/main/` and `src/renderer/` (and `src/backend/` from T2 on). New files in those folders must belong to a declared feature.
- Mutation testing: `dharness mutate <path>` once a file's tests are green.
- `commit-msg`: Conventional Commits (`feat:`, `fix:`, `docs:`…).
- `pre-push`: the test suite.

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
