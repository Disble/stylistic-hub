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
| D1 | Components | Three kinds, each with its own repo and tags: `hub` (`hub-v*`), `server` (`server-v*`, run in the hub's `utilityProcess`), `module` (an `id` and a `kind`; first kind `office-addin`). |
| D2 | Release artifact | Each server and module release publishes a zip and a `component.json` (`id`, `kind`, `version`, `channel`, `sha256`, `size`, `requires`, `provides`, release notes URL) as GitHub Release assets of its own repo. |
| D3 | Own signing, no CA | ed25519 detached signature over `component.json`; private key only in CI secrets; the hub embeds a keyring with key ids; revoked key ids ship in the catalog. |
| D4 | Signed catalog (TUF-lite) | The hub repo publishes a signed `catalog.json` with a monotonic `serial` and an `expires` date (rejects rollback and freeze), plus `rolloutPercent` and version blocking. |
| D5 | Update engine | In the hub's main process: check, resumable download to staging, verify size/sha256/signature, resolve compatibility, install atomically under `components/<id>/<version>/` with a `current` pointer, keep the previous version, zip-slip guard. |
| D6 | Health checks and rollback | `/api/v1/status` for the server, manifest and task pane for a module; failure or a crash loop rolls back, records why, and the bad version is not retried. |
| D7 | Server data safety | Forward-only expand/contract migrations; SQLite copy before a higher `schemaVersion`; restore on rollback; downgrade below the schema refused without a backup. |
| D8 | Module serving and Word | Each module at `/m/<id>/`; Word re-registers only when the manifest identity changes; new versions apply on the next task pane open, with `/api/v1/modules` to offer a reload. |
| D9 | Channels and rollout | `stable` (`main`) and `beta` (`dev`) per component; staged rollout by install-id hash; versions can be pulled. |
| D10 | Hub self-update | electron-updater from the hub's GitHub Releases, unsigned, same channels. |
| D11 | Library UI | HoYoPlay-like cards per component: versions, channel, progress, notes, install/update/repair/uninstall/roll back, history; first run downloads the server and chosen modules. |
| D12 | Pipeline and contracts | Per-repo GitHub Actions (check, build, pack, sign, publish); catalog changes by reviewed PR; module contract in module CI; OpenAPI diff fails a breaking change without a new API major; developer overrides. |

The full wording, diagrams and the install/update/rollback sequence live in [architecture](../architecture.md#target-architecture-component-delivery).

## Alternatives rejected

- **Bundled-only with build-time pinning.** Keep one installer, but pin each component's version in the hub's build. Reproducible, but still one slot: every add-in or server fix ships as a new hub installer, which is the scaling problem L1 describes.
- **Hybrid: modules in the installer, updated online later.** Offered at first for offline installs. Rejected because it was comfort, not necessity (L3): analysis already needs the model provider over the network, so an offline first run buys nothing, and two delivery paths double the cases to test.

## Accepted non-goals

| Non-goal (S2) | Consequence |
|---|---|
| (a) An Authenticode code-signing certificate for the hub installer. | Windows SmartScreen warns on the first install of the hub. Components are still signed with our own keys (D3), so only the one-time hub installer is unsigned; hub self-updates are unsigned too (D10). |
| (b) Microsoft Marketplace or centralized deployment for the add-in. | Word keeps loading the add-in through the sideload trigger, so the trigger window (about a second per Word session) stays ([architecture](../architecture.md#components), Word session loader). |

## Consequences

- **Becomes possible:** add-in and server fixes reach users without a hub reinstall; each component releases at its own pace; a bad release rolls back automatically; new module kinds fit the same pipeline; every installed byte is traceable to a signed CI artifact.
- **Costs:** own code for the catalog, signature checks and the update engine, and its fault-injection tests (see the [world-class bar](../roadmap.md#world-class-bar)); CI and signing in three repos; the API's compatibility discipline (v1 additive only) and expand/contract migrations become rules, not habits.
- **Risks:**
  - *Signing key compromise.* Rotation by key id (D3): ship a hub with the new public key, sign with it, and list the old key id as revoked in the catalog. A stolen catalog key is the worst case, which the hub limits only with `expires` and `serial`; separating the catalog key from the component key is a note to weigh in that milestone.
  - *Migration rollback limits.* Restoring the SQLite copy (D7) loses whatever was written after the upgrade (analyses, feedback, profile changes). Expand/contract keeps rollback to the previous release possible without a restore; going further back needs a backup.
  - *Network dependency on first run.* Without network the hub installs but has no server or modules until it can download them; the same is already true of analysis.

### Notes on adoption

Per "do not reinvent the wheel" ([`AGENTS.md`](../../AGENTS.md)), what was considered for each own mechanism:

- **Signing:** Node's `crypto` verifies ed25519 natively, so no library is needed to check signatures. Sigstore/cosign keyless signing needs an OIDC identity and a transparency log online at verification time, which a local-first hub should not depend on. minisign's format is ed25519 too and could be the file format (note, to decide in the milestone).
- **Catalog:** TUF is the reference design and D4 takes its rollback and freeze protections. Note: `tuf-js` (TypeScript TUF client, used by sigstore-js) exists and should be evaluated in the signed-catalog milestone; full TUF (root, targets, snapshot and timestamp roles, threshold keys) is heavier than one maintainer needs, which is why the decision says TUF-lite. If `tuf-js` fits, it replaces our verification code and the catalog follows TUF's format.
- **Update engine:** electron-updater updates only the hub shell (used for D10); Squirrel.Windows, Velopack and Omaha are whole-application updaters with no notion of independently versioned components inside one app. Zip extraction reuses an existing library (the hub already depends on `adm-zip`), with our zip-slip check on top.
