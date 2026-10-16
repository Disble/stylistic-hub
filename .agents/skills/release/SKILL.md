---
name: release
description: "Trigger: release, publish a version, beta or test release, changelog, build the installer. Releases the server and the hub with semantic-release."
license: MIT
metadata:
  author: stylistic
  version: "1.0"
---

# Release

## Activation Contract

Use when cutting a version of the Local server or the hub, a test (prerelease) version, or the Windows installer.

## Hard Rules

- semantic-release decides versions from Conventional Commits; never edit `version` fields, `CHANGELOG.md` or `src/backend/CHANGELOG.md` by hand.
- Two components, released separately: server (`src/backend/`, tags `server-vX.Y.Z`, only commits touching it) and hub (repo root, tags `hub-vX.Y.Z`, all commits, builds the installer).
- Release from a release branch only, using semantic-release's default branches: `main` for stable versions, `next`/`next-major`/`N.x` for channels and maintenance, `beta` and `alpha` for test releases (`X.Y.Z-beta.N`). Never from `feat/*`.
- A run without `--dry-run` pushes the release commit and tag to `origin` itself: get the user's go-ahead before it.

## Decision Gates

- No `origin` remote → stop: semantic-release fails with `ENOREPOURL`.
- No `hub-v*`/`server-v*` tag → ask before tagging the current versions (`git tag hub-v0.0.1 && git tag server-v0.0.1`); otherwise the first release is 1.0.0.
- Dry run reports "no relevant changes" → nothing to release; stop.

## Execution Steps

1. `git switch main` (or `beta`/`alpha` for a test release), then `git pull`. Working tree must be clean.
2. `bun run addin:bundle ../stylistic-addon` — the installer bundles the add-in.
3. `bun run release:server --no-ci --dry-run`, then `bun run release:hub --no-ci --dry-run`; read the next versions. Outside CI semantic-release always dry-runs unless given `--no-ci`.
4. `bun run release:server --no-ci` first: the hub reads `SERVER_VERSION` from `src/backend/package.json`.
5. `bun run release:hub --no-ci`: bumps `package.json`, writes `CHANGELOG.md`, builds `release/StylisticHub-Setup-<version>.exe` (about 10 minutes), commits and tags.

## Output Contract

Report each component's version and tag, the installer path, and anything not pushed or not run.

## References

- `docs/development.md` — scripts.
- `.releaserc.json`, `src/backend/.releaserc.json` — configuration.
