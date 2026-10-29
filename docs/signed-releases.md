# Signed releases and catalog

How the server and the modules are published as signed artifacts, and how the catalog and the key list reach the hub, as [ADR 0001](adr/0001-component-delivery.md) (D2–D4, D12) designs them and roadmap M3 builds them. The keys themselves and the ceremony that created them: [signing keys](keys.md). Downloading, verifying and installing on the hub's side comes in M4.

## Documents

All signatures are ed25519 over the document's canonical JSON: object keys sorted at every depth, no whitespace. Ids, kinds, publishers and key scopes match `^[a-z][a-z0-9-]{1,40}$`; versions are semver with an optional `-beta.N`. The zod schemas are in `src/shared/signing/documents.ts`.

| File | Signed by | Signature file | Content |
|---|---|---|---|
| `keys.json` | Root key (offline) | `keys.json.sig`: base64 of the root's signature | `version` (increases with every change), `expires` (13 months), `keys`: `id`, `role` (`catalog` or `component`), `scope` (component keys: the repository whose streams they sign), `publicKey` (raw 32 bytes, base64) |
| `catalog.json` | A key listed with role `catalog` | `catalog.json.sig`: envelope | `serial` (Unix seconds at signing), `expires` (+14 days), `components`: `id`, `kind`, `publisher`, `channel`, `version`, `sha256`, `size`, `artifactUrl`, `componentUrl`, `rolloutPercent` (0–100), `blocked` (versions) |
| `component.json` | A key listed with role `component` and scope = the publisher | `component.json.sig`: envelope | `id`, `kind`, `version`, `channel` (`stable` or `beta`), `sha256` and `size` of the zip, `maxUncompressedSize` (the zip's uncompressed size, the cap extraction enforces), `requires`, `provides`, `releaseNotes` (URL) |

The envelope names its signer, so a verifier can tell an unknown key from a known key with the wrong role:

```json
{ "keyId": "<first 16 hex characters of the sha256 of the raw public key>", "signature": "<base64>" }
```

For the server, `provides` is `{ "api": ["v1"], "schemaVersion": <n>, "minReaderSchema": <n> }`; both numbers are the database schema version the server migrates to (M4 gives `minReaderSchema` its own value), and `requires` is `{}`.

Formats evolve only by adding optional fields. The schemas keep fields they do not know, so the signature, which covers every received field, still verifies on hubs released before the field existed. A new value in an existing enum (a new key role or channel) fails parsing on those hubs, so it needs a hub release first.

## Verification

`src/shared/signing/verify.ts` holds pure functions over parsed documents (`node:crypto` and zod only, coverage tier `core`). Each returns `'ok'` or the reason:

| Function | Inputs | Rejections, in the order checked |
|---|---|---|
| `verifyKeyList` | list, `keys.json.sig`, root and next-root public keys, last seen `version`, now | `bad_signature`, `invalid_list` (duplicate ids, an id that is not its public key's, a public key that is not 32 bytes), `replayed` (lower `version`), `expired` |
| `verifyCatalog` | catalog, envelope, verified key list, last seen `serial`, now | `unknown_key`, `wrong_role`, `bad_signature`, `rollback` (lower `serial`; equal is accepted), `expired` |
| `verifyComponent` | component.json, envelope, key list, expected publisher | `unknown_key`, `wrong_role`, `bad_signature`, `wrong_scope` (checked in that order) |
| `verifyArtifact` | component.json, measured `sha256` and `size` of the zip | `size_mismatch`, `sha256_mismatch` |

A revoked key is a key the current `keys.json` no longer lists, so whatever it signed fails as `unknown_key`.

## Scripts

| Command | What it does |
|---|---|
| `bun run build:server` | Bundles `src/backend/entry.ts` into `out/server/entry.js` with vite (`vite.server.config.ts`), keeping `@earendil-works/*` and the Node builtins external, then copies the hub's `package.json` and `bun.lock` into `out/server/` unchanged and runs `bun install --production --frozen-lockfile --ignore-scripts` there, so every transitive dependency is the locked one. |
| `bun scripts/release/pack-server.ts --version <v> --channel <stable\|beta> [--out <dir>]` | Packs `out/server/` as the `server` component into `out/server-release/`: `server-<version>.zip`, `component.json`, `component.json.sig`, signed with `STYLISTIC_COMPONENT_KEY`. |
| `bun scripts/release/pack-component.ts (--dir <dir> | --file <file>) --out <dir> --id <id> --kind <kind> --version <v> --channel <c> --release-notes <url> [--requires <json>] [--provides <json>]` | The generic packer behind `pack-server.ts`: zips a directory (`yazl`) as `<id>-<version>.zip` and writes the signed `component.json` beside it. A module packs with it too. With `--file` it zips nothing and pins that one file as it is, with `maxUncompressedSize` equal to its size (the hub's NSIS installer). |
| `bun scripts/catalog/sign-catalog.ts [--source <file>] [--out <dir>]` | Writes `catalog.json` (the source plus `serial` and `expires`) and `catalog.json.sig` into `out/catalog/`, signed with `STYLISTIC_CATALOG_KEY`. |
| `bun scripts/catalog/catalog-entry.ts --source <file> --component <component.json> --publisher <name> --release <url/> --asset <name>...` | Writes a release's entry into the catalog source: `sha256` and `size` from its `component.json`, `artifactUrl` at its one asset besides `component.json` and its signature (any other count is an error), `componentUrl` at its `component.json`. It replaces the entry of the same id and channel, keeping that entry's `rolloutPercent` and `blocked`, or adds one fully rolled out; it prints `changed`, or `unchanged` when that entry already names the version and sha256. |
| `bun run keys:dev` | Writes a development root, catalog and component key (unencrypted), a signed `keys.json` and an empty signed catalog to `.dev-keys/` (gitignored), replacing what is there. Production builds never trust them. |
| `scripts\keys\update-key-list.ps1 -Rotate <target>` or `-Revoke <keyId>` | The maintainer's key list changes with the root key; see [signing keys](keys.md#later). |

Signing keys are PKCS#8 PEMs read from the environment; in CI they are the GitHub secrets of [signing keys](keys.md).

## Workflows and URLs

- **Server release** (`.github/workflows/ci.yml`, job `release-server`, on a push to `dev` or `main`): semantic-release's prepare step (`src/backend/.releaserc.json`, `@semantic-release/exec`) runs `build:server` and `pack-server.ts` with the computed version and channel (`beta` on `dev`, `stable` on `main`), and `@semantic-release/github` attaches the three files to the `server-v<version>` release: `https://github.com/Disble/stylistic-hub/releases/download/server-v<version>/server-<version>.zip`, and `component.json` and `component.json.sig` at the same path.
- **Hub release** (job `release-hub`, after `release-server`): semantic-release (`.releaserc.json`) runs `bun run dist`, then `pack-component.ts --file release/StylisticHub-Setup-<version>.exe --id stylistic-hub --kind hub` with the same channel rule and `STYLISTIC_COMPONENT_KEY`, and attaches the installer, `component.json` and `component.json.sig` to the `hub-v<version>` release. The catalog entry of `stylistic-hub` points `artifactUrl` at the installer and `componentUrl` at that `component.json`; the hub verifies it and installs it through electron-updater ([architecture](architecture.md#install-update-and-rollback)).
- **Catalog** (`.github/workflows/catalog.yml`, daily, on a push to `main` that touches `catalog/**` or `keys/**`, and by hand): signs `catalog/catalog.source.json`, which changes only by pull request, and uploads `catalog.json`, `catalog.json.sig`, `keys/keys.json` and `keys/keys.json.sig` to the release tagged `catalog` (created once as a prerelease, never marked latest, assets replaced in place). The hub reads all four from `https://github.com/Disble/stylistic-hub/releases/download/catalog/<file>`. Re-signing an unchanged source gives a higher `serial`, the same components and a valid signature, so the catalog never expires unattended.

- **Catalog entry** (job `catalog-entry` of `ci.yml`, after `release-hub`; odd/tasks/catalog-auto-update.md): reads the server and hub versions of the branch head, and for each `server-v<version>` and `hub-v<version>` release runs `catalog-entry.ts` against `catalog/catalog.source.json` on `main`, once per channel as each release's signed `component.json` names it (not as the branch does: `dev` gets `main` merged back, so a run on `dev` can read a stable release). For each channel with a changed entry it pushes the branch `catalog/<tags>` and opens a pull request to `main`. A beta pull request is merged by the job, which then dispatches the Catalog workflow, because a merge made with `GITHUB_TOKEN` triggers no push workflow. A stable pull request waits for review, and merging it runs the Catalog workflow. The file is written with the repository's prettier config. A tag without a release is skipped; any other `gh` failure fails the job. Opening the pull request needs the repository setting "Allow GitHub Actions to create and approve pull requests". A rerun with nothing new changes nothing.

A module from another repository (the Word add-in) is still added by a pull request of its own once its release has published its artifact.

Channels read the catalog cumulatively: a `beta` install takes the newest of the `beta` and `stable` entries ([architecture](architecture.md)), so the catalog can list one entry per channel per component.
