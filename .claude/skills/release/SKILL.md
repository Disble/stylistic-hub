---
name: release
description: "Trigger: release, publish a version, beta or test release, changelog, build the installer, local installer, instalador. Builds the Windows installer locally; releases the server and the hub with semantic-release once the remote exists."
license: MIT
metadata:
  author: stylistic
  version: "2.0"
---

# Release

## Activation Contract

Use when building the Windows installer on this machine (the current mode: there is no `origin` remote yet), or, once the remote exists, cutting a version of the Local server or the hub, including a test (prerelease) version.

## Local installer (current mode)

### Hard Rules

- Never edit `version` in `package.json` by hand: the installer carries the version semantic-release last wrote (`node -p "require('./package.json').version"`). A local build does not bump it, so two builds can share a file name; the commit tells them apart.
- Build from `main` or a `release/*` branch. Another branch (`dev`, `feature/*`) is acceptable only for a local test build, and the report must say so.
- No remote, no tags, no commits: this mode only writes `out/`, `out/word` and `release/`.

### Decision Gates

- Dirty working tree (`git status --short` not empty) → stop: the installer would not match any commit.
- `bun run check` fails → stop and report; do not build.

### Execution Steps

1. `git branch --show-current` and `git status --short`: apply the gates; record `git rev-parse --short HEAD`.
2. `bun run check`.
3. `bun run dist`: the NSIS installer `release/StylisticHub-Setup-<version>.exe` (about a minute). It stages the Word loader and trigger into `out/word` first; no add-in checkout is needed, because the installer ships no add-in and Word loads the catalog module. For an unpacked app to try without installing: `bun run dist:dir` → `release/win-unpacked/`.
4. Verify the artifact: the file exists, its size (about 160 MB) and its timestamp is from this run (`ls -l release/*.exe`).
5. To install here: stop `bun run dev` first (the installed hub and the dev hub both want port 3000), then run the `.exe`; it installs per user without asking.

### Output Contract

Report the branch and short commit, the version, the installer path, size and timestamp, and anything not run.

## When the remote exists

### Hard Rules

- semantic-release decides versions from Conventional Commits; never edit `version` fields, `CHANGELOG.md` or `src/backend/CHANGELOG.md` by hand.
- Two components, released separately: server (`src/backend/`, tags `server-vX.Y.Z`, only commits touching it) and hub (repo root, tags `hub-vX.Y.Z`, all commits, builds the installer).
- Git Flow (`docs/git-flow.md`): stable versions only from `main`, after merging a `release/*` or `hotfix/*` branch; test releases (`X.Y.Z-beta.N`) only from `dev`. Both configs set these `branches`. Never from `feature/*`, `release/*` or `hotfix/*`.
- A run without `--dry-run` pushes the release commit and tag to `origin` itself: get the user's go-ahead before it.

### Decision Gates

- No `origin` remote → stop: semantic-release fails with `ENOREPOURL`; use the local installer mode.
- No `hub-v*`/`server-v*` tag → ask before tagging the current versions (`git tag hub-v0.0.1 && git tag server-v0.0.1`); otherwise the first release is 1.0.0.
- Dry run reports "no relevant changes" → nothing to release; stop.

### Execution Steps

1. Stable: merge `release/X.Y.Z` (or `hotfix/X.Y.Z`) into `main` with `--no-ff`, then `git switch main`. Test release: `git switch dev`. Then `git pull`; working tree must be clean.
2. Pushing `main` (or `dev`) is the release: the CI `release-server` and `release-hub` jobs run semantic-release with the signing secrets. Run them locally only when the component key is exported in your shell; the prepare step signs `component.json` and fails without it.
3. `bun run release:server --no-ci --dry-run`, then `bun run release:hub --no-ci --dry-run`; read the next versions. Outside CI semantic-release always dry-runs unless given `--no-ci`.
4. `bun run release:server --no-ci` first: the hub reads `SERVER_VERSION` from `src/backend/package.json`.
5. `bun run release:hub --no-ci`: bumps `package.json`, writes `CHANGELOG.md`, builds `release/StylisticHub-Setup-<version>.exe`, commits and tags.
6. After a stable release, merge `main` back into `dev` so it carries the release commits.

### Output Contract

Report each component's version and tag, the installer path, and anything not pushed or not run.

## References

- `docs/git-flow.md` — branches and what releases from where.
- `docs/development.md` — scripts.
- `docs/addin-contract.md` — what a development `addin:bundle` checks; the installer ships no add-in.
- `.releaserc.json`, `src/backend/.releaserc.json` — configuration.
