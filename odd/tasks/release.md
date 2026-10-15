# Release — semantic-release, changelogs and test releases

Objective: release the hub and the local server with semantic-release, each with its own version and changelog, through a project `release` skill that also builds the installer; test releases follow semantic-release's prerelease branches.
Branch: `feat/release` (from `feat/mvp` at `a8eaa45`) · Delivery: `ask-on-risk` · Test runner: vitest (`bun run test`).

## Specs

- **R-S1 — Release skill with the installer.** "Genera el instalador de nuevo, conviertelo en parte de una skill reléase". A project skill `release` whose steps include building the installer (`bun run addin:bundle` + `bun run dist`).
- **R-S2 — semantic-release and changelogs.** "manejaremos semántic reléase y changelogs." Versions come from Conventional Commits; each release writes its `CHANGELOG.md`, commits and tags.
- **R-S3 — Test releases per the spec.** "También reléase de pruebas según la especificacion de semántic reléase." semantic-release's prerelease branches (`beta`, `alpha` → `X.Y.Z-beta.N`) and its default branch set; no custom scheme.
- **R-S4 — Each component separately.** Answer to "¿Qué debe versionar semantic-release en stylistic-hub?": "Cada uno por separado" — "Dos releases independientes (hub y servidor) por rutas de commits, con tags con prefijo y dos CHANGELOG. Necesita semantic-release-monorepo y un package.json por componente". Hub = root `package.json` (installer version), all commits; server = `src/backend/`, only commits touching it; `SERVER_VERSION` reads the server's version (S6 of the MVP).
- **R-S5 — Keep current versions.** Assumption: both components continue from 0.0.1 (baseline tags), so the next `feat` gives 0.1.0, not semantic-release's default first release 1.0.0.

## Tasks

| ID | Specs | Task | Route | Status | Evidence |
|---|---|---|---|---|---|
| R1 | R-S2, R-S4 | Dev dependencies; hub config at the root, server config + manifest in `src/backend/`; `SERVER_VERSION` from the server manifest; scripts | inline | done (commit below) | L5 |
| R2 | R-S2, R-S3, R-S5 | Probe in a scratch clone with a bare `origin`: hub and server releases from `main`, a `beta` prerelease, baseline tags, changelogs | inline | todo | |
| R3 | R-S1 | `.claude/skills/release/SKILL.md` (registered in `AGENTS.md`) + docs | inline | todo | |

## Log

- **L1 (2026-10-15, user):** "Genera el instalador de nuevo, conviertelo en parte de una skill reléase, manejaremos semántic reléase y changelogs. También reléase de pruebas según la especificacion de semántic reléase."
- **L2 (2026-10-15, user answer):** versioning → "Cada uno por separado".
- **L3 (installer):** rebuilt `release/StylisticHub-Setup-0.0.1.exe` (162 MB, NotSigned, no `*.map`) from `a8eaa45` with the add-in from `stylistic-addon` `feat/hub-adapter` `5cd3a98`.
- **L4 (research):** `semantic-release` 25.0.9; `semantic-release-monorepo` 8.0.2 (last publish 2024-02, peer `semantic-release >=22.0.7`, filters commits by the files under the package root, applied with `extends`, tags `<name>-v<version>`); `@anolilab/multi-semantic-release` needs workspaces, rejected. Constraints found: semantic-release releases only from release branches and needs a pushable `repositoryUrl`; this repo has no remote yet and the work sits on `feat/*`, so real releases wait for the user's remote and merge; R2 proves the setup in a scratch clone.
- **L5 (R1):** dev deps pinned: `semantic-release` 25.0.9, `semantic-release-monorepo` 8.0.2, `@semantic-release/changelog` 7.0.0, `@semantic-release/git` 11.0.1, `@semantic-release/exec` 7.1.0, `conventional-changelog-conventionalcommits` 10.4.1 (`@semantic-release/npm` comes with semantic-release). Hub: root `.releaserc.json`, tag `hub-v${version}`, `CHANGELOG.md`, `npm` plugin with `npmPublish: false` bumps `package.json`, `exec` runs `bun run dist` in prepare so the installer carries the new version, `git` commits `chore(release): hub X.Y.Z`. Server: `src/backend/package.json` (name `server`, 0.0.1) + `src/backend/.releaserc.json` extending `semantic-release-monorepo`, tag `server-v${version}`, `src/backend/CHANGELOG.md`. `branches` not set: semantic-release's defaults already are `N.x`, `main`/`master`, `next`, `next-major`, `beta` and `alpha` as prereleases (read in `node_modules/semantic-release/lib/get-config.js:64-71`). `SERVER_VERSION` now reads `src/backend/package.json` (RED: test failed with ENOENT before the manifest existed). Scripts `release:server` and `release:hub`. Dry run here: `ENOREPOURL The repositoryUrl option is required` — no remote yet.
