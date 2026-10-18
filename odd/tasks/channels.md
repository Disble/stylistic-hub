# M6 — Channels and rollout

Objective: roadmap M6 (docs/roadmap.md), ADR 0001 D4, D9, as the smallest thing that meets the exit criteria. Branch `feature/channels` from `dev`. Runner: vitest; local gate `bun run check`. Delivery: work-unit commits merged `--no-ff` into `dev`; no merge to `main` while the maintainer is away.

## Specs

Exit criteria quoted from the roadmap: "an installed hub on `beta` updates itself to a published `hub-v*` prerelease and back to stable on switching; switching a component to `beta` installs its latest prerelease and switching back offers the latest stable; with `rolloutPercent: 10` a simulated population of install ids gets the update at about 10%; a version pulled from the catalog is no longer offered."

- **S1 Channel per component** (`src/main/updates/`): `state.json` gains, per component, `channel: 'stable' | 'beta'` (missing = `stable`, so M4 state files read unchanged) and a hub entry for the hub's own channel. The engine and the self-update follow each component's channel instead of the constant `stable`. A beta channel accepts `beta` entries only (the catalog lists both channels per component; no mixing rules beyond that).
- **S2 Switching back** ("switching back offers the latest stable"): after a switch to `stable`, the stable version is installed even when older than the running beta (a downgrade), except for the server when that stable version cannot read the database: its `provides.schemaVersion` is below the database's `minReaderSchema` (read with `readSchemaState`). Then the server stays on its beta version, nothing is restored, and the reason is recorded in history and shown ("stays on <beta> until stable reads this database"). The hub's own downgrade sets electron-updater's `allowDowngrade` only for a channel switch.
- **S3 Staged rollout** (D4, D9): `state.json` gains a random `installId` (UUID, created once). An entry is offered when `rolloutPercent` is 100, or when `sha256(installId + ':' + id + ':' + version)`, read as an unsigned 32-bit integer from its first 4 bytes, modulo 100, is below `rolloutPercent`. A test draws 10 000 random ids at `rolloutPercent: 10` and gets between 9% and 11%; the same id always gets the same answer.
- **S4 Pulled versions** (D4): a version listed in the entry's `blocked` is never installed nor offered by self-update. (An installed blocked version is left running: replacing it is what a newer catalog version does. **Assumption**, logged.)
- **S5 UI**: the Server screen gets one channel choice for the server and one for the hub (`stable`/`beta`), through the existing IPC/bridge pattern; a change triggers a catalog check. Nothing else (the library UI is M5).
- **S6 Docs**: docs/architecture.md (channels, rollout, pulled versions), docs/signed-releases.md if the catalog source changes, roadmap status at close.

**Out of scope:** the library UI, per-module channel UI (M5 adds module cards), rollout telemetry.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1–S6 | delegated writer (context backstop; parallel with M8 in its own worktree) | open | |
| T2 | all | independent verifier if the Risk line names a high-risk item | open | |

## Log

- **L1** (2026-10-18) User: "desde ahora tendrás que continuar con el resto por tu cuenta … cuidado con la sobreingeniería … las decisiones delicadas se las toma midiendo, y probando hipótesis falsables …".
- **L2** S2's schema guard is the measured answer to a real risk: a beta server may have run a contract migration (update-engine S1), and a stable server older than it refuses that database (`openDatabase` newer-schema rule), which would crash-loop into a rollback back to beta. Hypothesis to falsify in a test: "switching to stable with a beta contract migration never starts a server that refuses the database".
