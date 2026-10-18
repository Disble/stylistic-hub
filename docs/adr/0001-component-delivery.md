# ADR 0001 — Component delivery: the hub is a launcher

- **Status:** Accepted (2026-10-17)
- **Source:** [`odd/tasks/launcher-plan.md`](../../odd/tasks/launcher-plan.md) S1–S4, D1–D12, L1–L4.
- **Design:** [Target architecture: component delivery](../architecture.md#target-architecture-component-delivery). **Milestones:** [roadmap](../roadmap.md).

## Context

Today one NSIS installer carries everything. `bun run addin:bundle` builds a sibling checkout of `stylistic-addon` (default `../stylistic-addon`) into `resources/addin/`, the backend is bundled into the hub's own build, and `bun run dist` packs both into one per-user installer ([add-in contract](../addin-contract.md)). It does not scale:

- **One slot.** The hub holds exactly one add-in and one backend; changing either means rebuilding and reinstalling the whole hub.
- **Not reproducible.** What gets bundled is whatever the sibling checkout has at build time; the add-in commit is recorded only by hand in tags and logs.
- **No compatibility check.** Nothing states which add-in works with which API, so nothing can refuse a mismatch.

The user's goals (L1–L4): every subproject stays independent and is still served by the hub; it must be iterable and scalable (L1). The model is a launcher like HoYoPlay, which installs and updates Genshin, ZZZ and others without reinstalling itself (L2). The backend got its own version tag (`server-v*`) precisely so it can update on its own; aim big from the start, and cross the limits with own development (L3). Two items are accepted as not done; everything else is to be built, world-class (L4).

## Decision

The hub is installed once and becomes a launcher. The hub, the server and every module are versioned, released and updated independently. The installer may carry nothing but the hub; there is no hybrid fallback as a goal (S1).

| # | Decision | In one line |
|---|---|---|
| D1 | Components | Three kinds, each with its own release stream and tags: `hub` (`hub-v*`), `server` (`server-v*`, run in the hub's `utilityProcess`), `module` (an `id` and a `kind`; first kind `office-addin`). Two repos today: `stylistic-hub` publishes `hub` and `server`, `stylistic-addon` publishes the add-in. |
| D2 | Release artifact | Each server and module release publishes a zip and a `component.json` (`id`, `kind`, `version`, `channel`, `sha256`, `size` and the uncompressed size cap, `requires`, `provides` (for the server: the API versions, `schemaVersion` and the `minReaderSchema` its migrations set), release notes URL) as GitHub Release assets of its own repo. |
| D3 | Own signing, no CA | ed25519 signatures with two key roles: an offline root key signs `keys.json` (the online keys and their roles); an online catalog key signs `catalog.json`; online component keys sign `component.json`. `keys.json` carries a monotonic `version` and a 13-month `expires`, re-signed by the root key every year (a month of margin). Online keys rotate and are revoked with a new root-signed `keys.json`, with no new hub; the hub rejects a lower `version` or an expired list. |
| D4 | Signed catalog (TUF-lite) | The hub repo publishes a signed `catalog.json`, hub included as a component, with a monotonic `serial` and an `expires` date (rejects rollback and freeze), plus `rolloutPercent` and version blocking. A daily CI job re-signs it (+14 days); an expired catalog only pauses updates, installed components keep running. |
| D5 | Update engine | In the hub's main process: check, resumable download to staging, verify size/sha256/signature, check that `component.json` matches the catalog entry before extraction, resolve compatibility, install atomically under `components/<id>/<version>/` with a `current` pointer, keep the previous version, strict extraction (no absolute paths, `..`, symlinks, reserved names; size cap). |
| D6 | Health checks and rollback | `/api/v1/status` for the server, manifest and task pane for a module; failure or a crash loop (new work in `supervisor.ts`) rolls back, records why, and the bad version is not retried. |
| D7 | Server data safety | Forward-only expand/contract migrations; each release declares the `schemaVersion` it writes and the `minReaderSchema` its migrations set (a property of the database: the lowest server `schemaVersion` that can still read it); `VACUUM INTO` backup before a higher `schemaVersion` starts; restore only when a rollback crosses a contract step; downgrade below the database's `minReaderSchema` refused without a readable backup. |
| D8 | Module serving and Word | Each module at `/m/<id>/`; the manifest registered at a stable path and re-registered when its content hash changes; new versions apply on the next task pane open, with `/api/v1/modules` to offer a reload; cutover from 0.0.1 in two steps: the M4 hub (installed by hand once) migrates the database in place; the M5 hub, delivered by self-update, moves the add-in to `/m/<id>/`. |
| D9 | Channels and rollout | `stable` (`main`) and `beta` (`dev`) per component; staged rollout by install-id hash; versions can be pulled. |
| D10 | Hub self-update | The hub is a catalog component: the engine verifies its installer (sha512 and our signature), then serves that same file from a loopback feed and electron-updater installs it; "unsigned" means no Authenticode only; same channels. |
| D11 | Library UI | HoYoPlay-like cards per component: versions, channel, progress, notes, install/update/repair/uninstall/roll back, history; first run downloads the server and chosen modules. |
| D12 | Pipeline and contracts | Per-repo GitHub Actions (check, build, pack, sign, publish); catalog changes by reviewed PR; module contract in module CI; OpenAPI diff fails a breaking change without a new API major; developer overrides. |

The full wording, diagrams and the install/update/rollback sequence live in [architecture](../architecture.md#target-architecture-component-delivery).

## Alternatives rejected

- **Bundled-only with build-time pinning.** Keep one installer, but pin each component's version in the hub's build. Reproducible, but still one slot: every add-in or server fix ships as a new hub installer, which is the scaling problem L1 describes.
- **Hybrid: modules in the installer, updated online later.** Offered at first for offline installs. Rejected because it was comfort, not necessity (L3): analysis already needs the model provider over the network, so an offline first run buys nothing, and two delivery paths double the cases to test.

## Accepted non-goals

| Non-goal (S2) | Consequence |
|---|---|
| (a) An Authenticode code-signing certificate for the hub installer. | Windows SmartScreen warns on the first install of the hub. Components are still signed with our own keys (D3), and hub self-updates are verified against our signature too (D10); the only unsigned artifact, in the Authenticode sense, is the hub installer. |
| (b) Microsoft Marketplace or centralized deployment for the add-in. | Word keeps loading the add-in through the sideload trigger, so the trigger window (about a second per Word session) stays ([architecture](../architecture.md#components), Word session loader). |

## Consequences

- **Becomes possible:** add-in and server fixes reach users without a hub reinstall; each component releases at its own pace; a bad release rolls back automatically; new module kinds fit the same pipeline; every installed byte is traceable to a signed CI artifact.
- **Costs:** own code for the catalog, signature checks and the update engine, and its fault-injection tests (see the [world-class bar](../roadmap.md#world-class-bar)); CI and signing in two repos (more if a module gets its own); the API's compatibility discipline (v1 additive only) and expand/contract migrations become rules, not habits.
- **Risks:**
  - *Signing key compromise.* Keys have roles (D3). A compromised online key (catalog or component) is rotated with no new hub: the offline root key signs a new `keys.json` without it. Revocation lives in `keys.json`, not in the catalog, so the attacker cannot forge or roll it back: the list has a monotonic `version` and a one-year `expires`, the hub keeps the last-seen `version` beside the catalog `serial` and rejects a lower one or an expired list, and a replayed older `keys.json` is refused. A catalog is accepted only if signed by a key the current `keys.json` lists with the catalog role, a component only if signed by a key listed with the component role. Revocation is enforced at every catalog check, so an installed version covered only by a revoked key is disabled and replaced by the catalog's current version. Only a compromised root key needs a new hub, which is why the next root public key is embedded one release ahead. A stolen catalog key is still limited by `expires` and `serial`.
  - *Trust on first use after a reinstall.* The last-seen catalog `serial` and `keys.json` `version` live in `userData`; a reinstall that loses them trusts the first valid, unexpired `keys.json` and catalog. Accepted as trust-on-first-use.
  - *Migration rollback limits.* With the database's `minReaderSchema` (D7), an expand-step rollback opens the same database with no restore and no lost writes. Only a contract step, which raises `minReaderSchema`, needs the `VACUUM INTO` backup restored, which loses whatever was written after the upgrade (analyses, feedback, profile changes); the hub says so. Going further back than a readable schema needs a backup.
  - *Network dependency on first run.* Without network the hub installs but has no server or modules until it can download them; the same is already true of analysis.

### Notes on adoption

Per "do not reinvent the wheel" ([`AGENTS.md`](../../AGENTS.md)), what was considered for each own mechanism:

- **Signing:** Node's `crypto` verifies ed25519 natively, so no library is needed to check signatures. Sigstore/cosign keyless signing is rejected for its complexity (OIDC identity, transparency log, certificate chain) for one maintainer; verification can be done offline with a bundle, so offline use is not the reason. minisign's format is ed25519 too and could be the file format (note, to decide in the milestone).
- **Catalog:** TUF is the reference design and D4 takes its rollback and freeze protections. Note: `tuf-js` (TypeScript TUF client, used by sigstore-js) exists and should be evaluated in the signed-catalog milestone; full TUF (root, targets, snapshot and timestamp roles, threshold keys) is heavier than one maintainer needs, which is why the decision says TUF-lite. If `tuf-js` fits, it replaces our verification code and the catalog follows TUF's format.
- **Update engine:** electron-updater updates only the hub shell (used for D10: the engine serves the installer it already verified from a loopback feed with a `latest.yml`, and electron-updater's generic provider reads that feed); Squirrel.Windows, Velopack and Omaha are whole-application updaters with no notion of independently versioned components inside one app. Zip extraction reuses an existing library (the hub already depends on `adm-zip`), with our zip-slip check on top.
