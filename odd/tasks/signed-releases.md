# M3 — Signed releases and catalog

Objective: roadmap M3 (docs/roadmap.md), ADR 0001 D2–D4 and D12, built as the smallest thing that meets the exit criteria. Branch `feature/signed-releases` from `dev`. Runner: vitest (`bun run test`; local gate `bun run check` with coverage tiers). Delivery: work-unit commits, merged `--no-ff` into `dev`.

## Specs

Exit criteria quoted from the roadmap: "CI publishes a signed server artifact and a signed add-in artifact; verification tests reject a tampered zip (sha256 mismatch), a tampered `component.json` (bad signature), a signature by a key absent from the current `keys.json` or listed without the needed role, a catalog with a lower `serial` than the last seen one, an expired catalog, a replayed older `keys.json` (lower `version`), and an expired `keys.json`; the catalog re-sign job leaves a valid catalog with no content change; an online key is rotated end to end through a new `keys.json` signed by the root key, without a new hub; a key is revoked through a new root-signed `keys.json` without it".

- **S1 Verification library** `src/shared/signing/` (coverage tier `core`, 100%): pure functions over parsed documents, `node:crypto` and `zod` only.
  - `canonicalJson`, `keyId`, raw-key helpers move here from `scripts/keys/key-list.ts`, which then imports them (existing `keys/keys.json.sig` must still verify).
  - zod schemas for `keys.json`, `catalog.json`, `component.json` and the signature envelope. Ids match `^[a-z][a-z0-9-]{1,40}$`; versions are semver with an optional `-beta.N`.
  - `verifyKeyList` (root and next-root public keys, last seen `version`, now) → ok, or `bad_signature` | `replayed` (lower version) | `expired`. `keys.json.sig` keeps its existing format: base64 of the root's signature over the canonical list.
  - `verifyCatalog` (catalog, envelope, verified key list, last seen `serial`, now) → ok, or `unknown_key` | `wrong_role` | `bad_signature` | `rollback` (lower serial; equal is accepted) | `expired`.
  - `verifyComponent` (component.json, envelope, key list, expected publisher) → ok, or `unknown_key` | `wrong_role` | `wrong_scope` (component key's scope ≠ publisher) | `bad_signature`.
  - `verifyArtifact` (component.json, measured `sha256` and `size`) → ok, or `size_mismatch` | `sha256_mismatch`.
  - Catalog and component signatures are detached envelope files `<file>.sig` = JSON `{ "keyId": "<16 hex>", "signature": "<base64>" }` over the canonical JSON of the document.
  - One test per rejection named in the exit criteria, plus the accepting case.
- **S2 Component artifact**: `scripts/release/pack-component.ts` zips a directory (adopted library `yazl`), and writes `component.json` with the D2 fields — `id`, `kind`, `version`, `channel` (`stable` | `beta`), `sha256`, `size`, `maxUncompressedSize` (actual uncompressed size), `requires` (object, may be empty), `provides` (object), `releaseNotes` (URL) — and `component.json.sig` signed with the PEM in an env var. Generic, so the add-in can use the same format.
- **S3 Server artifact**: `build:server` produces `out/server/` (the backend entry bundled, `@earendil-works/*` kept external, their production dependency closure installed beside it); the server release (`release:server`) packs and signs it with `STYLISTIC_COMPONENT_KEY` (scope `stylistic-hub`) and attaches `server-<version>.zip`, `component.json`, `component.json.sig` to the GitHub Release. `provides` carries `api: ["v1"]`, `schemaVersion` and `minReaderSchema` (both the current schema version until M4 adds the property). Hypothesis H3 (falsifiable): the zip stays under 100 MB; if not, stop and report the measurement instead of optimizing.
- **S4 Catalog**: source `catalog/catalog.source.json` (changed by reviewed PR) lists `components` entries: `id`, `kind`, `publisher`, `channel`, `version`, `sha256`, `size`, `artifactUrl`, `componentUrl`, `rolloutPercent` (0–100), `blocked` (versions). `scripts/catalog/sign-catalog.ts` writes `catalog.json` = source + `serial` (Unix seconds at signing) + `expires` (+14 days) and its envelope, signed with `STYLISTIC_CATALOG_KEY`. Workflow `.github/workflows/catalog.yml` (daily schedule, manual dispatch, push to `main` touching `catalog/**`) signs it and uploads `catalog.json`, its `.sig`, `keys/keys.json` and its `.sig` to the GitHub Release tagged `catalog` (created once as a prerelease, never "latest"), so the hub fetches the catalog and the current key list from one stable URL. Re-signing an unchanged source yields a higher serial, the same components, and a valid signature (test).
- **S5 Key list maintenance** (root key, run by the maintainer): `scripts/keys/update-key-list.ts` + `.ps1` wrapper (same passphrase prompt as `ceremony.ps1`). `--rotate <target>` generates a new online key for one of the ceremony's targets, sets its GitHub secret, and replaces that target's entry; `--revoke <keyId>` drops an entry; both bump `version` and reset `expires` (+13 months), then sign with the root key. A test with throwaway keys proves: rotated list accepted, old list then rejected as `replayed`, revoked key's catalog signature rejected as `unknown_key`.
- **S6 Dev keys** (D12): `bun run keys:dev` writes a dev root, catalog and component keys, a signed `keys.json` and an empty signed catalog to `.dev-keys/` (gitignored). Production builds never trust it (the hub side comes in M4).
- **S7 Docs**: `docs/signed-releases.md` (formats, envelope, scripts, workflows, URLs); `docs/keys.md` "Later" points at S5; coverage tier declared in `coverage-tiers.json`.

**Out of scope (do not build):** download, extraction, install, the hub reading the catalog (M4); channels UI and rollout logic (M6); automatic catalog PRs; the hub's own artifact entry (waits for the first hub release, blocked on the add-in, see ci-contracts L3); Authenticode; any key or secret handling by the agent beyond `gh secret set` in S5.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1, S7 | delegated (context backstop) | open | |
| T2 | S2, S3 | delegated, after T1 | open | |
| T3 | S4, S5, S6 | delegated, after T1 | open | |
| T4 | all | independent verifier (high-risk item 2: signatures) | open | |

## Log

- **L1** (2026-10-18) User: "desde ahora tendrás que continuar con el resto por tu cuenta … cuidado con la sobreingeniería y sobredimensionalización … las decisiones delicadas se las toma midiendo, y probando hipótesis falsables …".
- **L2** Decisions taken before writing, to leave no gap: signature envelope with `keyId` so `unknown_key` and `wrong_role` are distinguishable; catalog and key list published on one fixed `catalog` release (no daily commits to `main`); serial = Unix seconds (monotonic without stored state); the root-signed real rotation needs the maintainer's passphrase, so S5 is proven with throwaway keys and the real run stays with the user.
