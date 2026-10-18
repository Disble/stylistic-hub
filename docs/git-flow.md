# Git Flow

How branches are named, where they start and where they merge. Releases themselves: the `release` skill (`.claude/skills/release/SKILL.md`).

## Branches

| Branch | Starts from | Merges into | Purpose |
|---|---|---|---|
| `main` | — | — | Deployable. Receives only merges from `release/*` and `hotfix/*`; every stable version is tagged here (`hub-vX.Y.Z`, `server-vX.Y.Z`). |
| `dev` | `main` | — | Main development branch. Always builds; test releases come from here. |
| `feature/<topic>` | `dev` | `dev` (`git merge --no-ff`) | One feature or fix. Delete it after the merge. |
| `release/X.Y.Z` | `dev` | `main`, then back into `dev` | Stabilization only: fixes, docs, version-neutral polish. No new features. |
| `hotfix/X.Y.Z` | `main` | `main`, then `dev` (or the open `release/*`) | Urgent fix to the deployed version. |

`X.Y.Z` is the version the branch is expected to produce; semantic-release still decides the real version from the commits.

## Rules

- No direct commits to `main`. `dev` takes merges from `feature/*`, `release/*` and `hotfix/*`, and small direct fixes only when no feature branch makes sense.
- Merge with `--no-ff` so each feature, release and hotfix stays visible as one merge commit.
- New branches use `feature/<topic>`; the older `feat/*` branches are historical and keep their names.
- Conventional Commits stay mandatory (`commit-msg` hook): semantic-release reads them to pick versions and write changelogs.
- Pushing and setting up the remote are the user's. Until `origin` exists, merges are local and the only release is a local installer.

## Releases and Git Flow

`.releaserc.json` (hub) and `src/backend/.releaserc.json` (server) set `branches` to:

- `main`: stable versions, after a `release/*` or `hotfix/*` merge.
- `dev`: prerelease versions `X.Y.Z-beta.N`, the test releases. semantic-release requires a prerelease branch to name its identifier, so `dev` uses `beta`.

`feature/*`, `release/*` and `hotfix/*` never release: they reach a version only through `main` or `dev`. A local installer (`bun run dist`) builds from any branch and does not change the version.
