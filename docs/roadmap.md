# Roadmap

Where Stylistic stands and what separates it from an official, world-class product. How the system fits together: [architecture](architecture.md). The product direction is a launcher: the hub is installed once and installs and updates the server and every module on its own ([ADR 0001](adr/0001-component-delivery.md), [target architecture](architecture.md#target-architecture-component-delivery)).

Every item cites where it comes from. **Proposal** marks an item or a grouping that no log entry or user decision asks for yet. The source documents are the feature documents in [`odd/tasks/`](../odd/tasks/) and the `known-good/*` tags (`git tag -n99 'known-good/*'`). The launcher milestones (M2–M6) come from [`odd/tasks/launcher-plan.md`](../odd/tasks/launcher-plan.md), whose design decisions are cited as D1–D12; their order follows their dependencies.

## Reached

| Milestone | Date | What it proves |
|---|---|---|
| `known-good/word-addin-loads` | 2026-10-16 | The hub's own loader makes Word load the add-in in the user's own document (Stylistic group in the Home tab, task pane opens), without injecting anything into Word. |
| `known-good/mvp` | 2026-10-17 | MVP approved by the user: "Analizar y sugerir" analyzes the selection through the hub's own backend (API v1, durable workflows, SQLite) and the task pane applies the suggestions as track changes and comments. |
| M1 — Product foundation | 2026-10-17 | One trunk and one way of working: every branch merged into `main`, Git Flow with `dev` ([Git Flow](git-flow.md)), the remote `github.com/Disble/stylistic-hub` with `main`, `dev` and the `known-good/*` tags pushed, the tags `hub-v0.0.1` and `server-v0.0.1` (versions continue from the approved MVP), and a local installer of the latest version (`StylisticHub-Setup-0.0.1.exe`) built by the `release` skill. Evidence: [`odd/tasks/product-foundation.md`](../odd/tasks/product-foundation.md) T1–T4, L6. |

## Next milestones

Each exit criterion is observable: a CI run, a test that injects the failure, or a release on the remote.

### M2 — CI and contracts

- **Goal:** what reaches `main` and `dev` is checked by a machine, and every contract between components is enforced before a release can exist.
- **Key features:**
  - GitHub Actions in each repo running `check`, build and pack on every push and pull request (D12). Evidence: today the checks run only in local hooks ([development](development.md#git-hooks-and-the-dharness-gate)).
  - The API's OpenAPI document (`GET /api/v1/openapi.json`) diffed against the last `server-v*` release; a breaking change fails unless the API major version changes. v1 is additive only; v2 is served alongside (D12).
  - The module contract: today's [add-in contract](addin-contract.md), generalized to any module with an `id` and a `kind`, run in the module's own CI (D1, D12).
  - The add-in repository merges its hub work into its `main`, so its CI can build what the hub serves: `feat/hub-analysis-adapter` (88a3102, the adapter bundled at the MVP) lacks `build:hub`, which lives only on the unmerged `feat/hub-adapter` (5cd3a98). Evidence: `known-good/mvp` open points; [`odd/tasks/addin-packaging.md`](../odd/tasks/addin-packaging.md) L3.
  - First real releases from the remote with semantic-release (`hub-vX.Y.Z`, `server-vX.Y.Z`, test releases `-beta.N` from `dev`). Evidence: configured and probed in a scratch clone, never run against the remote ([`odd/tasks/release.md`](../odd/tasks/release.md) L4, L6); "release commits under the real lefthook hooks" were never probed (L8).
- **Exit criteria:** CI green on `main` and `dev` in both repos (`stylistic-hub` and `stylistic-addon`); a pull request that removes a field from an API v1 response fails CI; an add-in build missing `manifest.xml` or `</head>` fails the add-in's CI; one `release:server` and one `release:hub` published from the remote.

### M3 — Signed releases and catalog

- **Goal:** every server and module release is a signed, self-describing artifact, and the hub can tell a genuine, current catalog from a forged, old or frozen one.
- **Key features:**
  - Release artifact: zip plus `component.json` (`id`, `kind`, `version`, `channel`, `sha256`, `size` and an uncompressed size cap, `requires`, `provides` with, for the server, the `schemaVersion` it writes and the `minReaderSchema` its migrations set, release notes URL) as GitHub Release assets of the repo that publishes each stream: `stylistic-hub` for `hub` and `server`, `stylistic-addon` for the add-in (D1, D2).
  - Own signing with key roles: an offline root key (off CI) signs `keys.json`; an online catalog key signs `catalog.json`; online component keys sign `component.json`; the hub embeds the root public key and the next one a release ahead. `keys.json` has a monotonic `version` and a one-year `expires` (re-signed by the root key at least yearly, an offline ceremony); the hub keeps the last-seen `version` beside the catalog `serial`; revocations live in `keys.json`, and a catalog or component is accepted only if signed by a key the current `keys.json` lists with that role (D3).
  - Signed `catalog.json` in the hub repo, changed through a reviewed PR, listing the hub, the server and the modules, with `serial`, `expires`, `rolloutPercent` and version blocking (D4, D12).
  - A scheduled CI job that re-signs the catalog daily (new `serial`, `expires` = +14 days) so it never lapses unattended (D4).
  - A dev signing key and a local catalog file for development (D12).
- **Exit criteria:** CI publishes a signed server artifact and a signed add-in artifact; verification tests reject a tampered zip (sha256 mismatch), a tampered `component.json` (bad signature), a signature by a key absent from the current `keys.json` or listed without the needed role, a catalog with a lower `serial` than the last seen one, an expired catalog, a replayed older `keys.json` (lower `version`), and an expired `keys.json`; the catalog re-sign job leaves a valid catalog with no content change; an online key is rotated end to end through a new `keys.json` signed by the root key, without a new hub; a key is revoked through a new root-signed `keys.json` without it, and an installed version covered only by that key is disabled.

### M4 — Update engine, server channel and hub self-update

- **Goal:** the server and the hub update on their own, without a manual reinstall, and a bad server version rolls back by itself without losing data. Hub self-update lives here, not later, so that every cutover after the first is automatic.
- **Key features:**
  - Update engine in the hub's main process: periodic checks, resumable download to staging, verification, a binding check that the signed `component.json` matches the catalog entry (`id`, `kind`, `version`, `channel`, `sha256`) with strict `id` and `version` patterns before anything is extracted, compatibility resolution, atomic install into `components/<id>/<version>/` with a `current` pointer, previous version kept (D5).
  - Strict extraction: rejects absolute paths, `..`, symlinks and Windows reserved names, and stops at the uncompressed size cap from `component.json` (D5).
  - An expired or older catalog never stops installed components: they keep running, offline too, the hub shows the reason and retries; the last-seen `serial` and `keys.json` `version` live in `userData` (D3, D4).
  - Hub self-update: the hub is a component in the signed catalog; the engine verifies its installer (sha512 and our signature), serves that same file from a loopback feed on the hub's own HTTPS server with a `latest.yml` carrying the verified sha512, and electron-updater's generic provider reads that feed, re-checks the sha512 and installs it, so the bytes installed are the bytes verified; "unsigned" means no Authenticode only (D10, non-goal S2 a).
  - Fixture-based compatibility tests (signed sample artifacts and catalogs) in place before modules ship, so the engine and the real releases cannot drift apart.
  - The server forked from `components/server/<current>/` instead of the hub's own build (D1); `--server <dir>` for development (D12).
  - Cutover from 0.0.1, step one: the first launcher hub (installed by hand once by users on 0.0.1, which has no self-update) runs the server from `components/server/` and migrates the 0.0.1 database in place (D7, D8). Step two is in [M5](#m5--module-library-and-add-in-delivery).
  - Health check on `/api/v1/status` and crash-loop detection with automatic rollback, the reason recorded, and the bad version never retried until a newer one appears (D6). Crash-loop detection is explicit new work in `supervisor.ts`, which today backs off forever: N exits within a window before a stable run mark the version failed. A failed first install with no previous version leaves the component "not installed" with the reason and a retry, never a restart loop.
  - Server data safety: expand/contract migrations as a rule; `minReaderSchema` is a property of the database, recorded by the migration that produced it (the lowest server `schemaVersion` that can still read it; an expand migration leaves it, a contract migration raises it to its own `schemaVersion`), and each release declares in `component.json` the `schemaVersion` it writes and the `minReaderSchema` its migrations set; `database.ts` opens a database at a newer schema when the server's own `schemaVersion` is at least that database's `minReaderSchema` (today it refuses any newer schema); a `VACUUM INTO` backup in the `userData` backups folder before a higher `schemaVersion` starts; restore (stop the server, remove stale `-wal`/`-shm`) only when a rollback crosses a contract step, and the hub says writes were lost; downgrade refused below the database's `minReaderSchema` without a readable backup (D7).
  - Local structured logs and an update history (quality bar).
- **Exit criteria:** an installed hub moves from one `server-v*` to the next from the catalog, and from one `hub-v*` to the next through the verified installer, with no manual reinstall; fault-injection tests pass for: the hub killed mid-install (the previous version still runs, the next check resumes or restarts), a corrupt download, a bad signature, an expired or older catalog (installed components keep running), a binding mismatch between `component.json` and the catalog entry (rejected before extraction), a zip with malicious entries (absolute path, `..`, symlink, reserved name, oversize; rejected), an update set whose API range breaks an installed module (refused), and a server that fails its health check or crash-loops (rolled back, version marked bad); a rollback after an expand step restores nothing and keeps the writes made since the upgrade, and a rollback after a contract step restores the backup; the fixture-based compatibility tests pass; a 0.0.1 install upgraded by hand to the M4 hub keeps its documents, profiles and history; a migration that drops a column read by the previous release fails a check (**proposal**: how the expand/contract rule is checked).

### M5 — Module library and add-in delivery

- **Goal:** the Word add-in is a module the hub downloads, updates and rolls back like the server, and the installer carries nothing but the hub.
- **Key features:**
  - Each module served at `/m/<id>/` with today's versioned asset URLs and `Cache-Control` (`bef61c1`); the registered manifest at a stable path (`components/<id>/manifest.xml`, rewritten on each version switch) and Word re-registered whenever that manifest's content hash changes; a new version applies on the next task pane open; `/api/v1/modules` lets the task pane offer a reload (D8).
  - Module health check: manifest and task pane served after the switch, rollback otherwise (D6).
  - Cutover from 0.0.1, step two: this hub, delivered by the M4 hub's self-update, moves the add-in to `/m/<id>/`, re-registers it in Word and removes the root-URL entry (D8). Step one (the database) is in [M4](#m4--update-engine-server-channel-and-hub-self-update).
  - Library UI: one card per component with versions, channel, progress, release notes, install, update, repair, uninstall and roll back, plus the update history; the first run downloads the server and the modules the user picks (D11).
  - Module-scoped tokens instead of the one shared hub token: a module reaches only the API scopes it declares (quality bar).
  - `--module <id>=<dir>` for development, generalizing today's `--addin <dir>` (D12).
  - Retire the hub's manifest shell (`resources/addin-shell/manifest.json`), which exists because the add-in manifest carried Microsoft's sample strings ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L50); the add-in's `main` now has `6c8abc0 fix(manifest): use Stylistic's own identity texts`. **Proposal**; with modules released from their own repo, the production identity belongs to the module's release.
- **Exit criteria:** a fresh install from a hub-only installer reaches a working "Analizar y sugerir" after the first-run download; an add-in update that leaves the manifest unchanged reaches Word on the next task pane open with no re-registration and no hub reinstall, and one that changes the manifest content is re-registered; an M4 hub self-updates to the M5 hub and the add-in loads from `/m/<id>/` with no manual step, no root-URL entry left; a module whose task pane is not served after the switch is rolled back; a module token is refused by an API scope the module did not declare.

### M6 — Channels and rollout

- **Goal:** each component, the hub included, can be tested on `beta` and rolled out gradually before everyone gets it. Hub self-update itself is delivered in [M4](#m4--update-engine-server-channel-and-hub-self-update); this milestone gives it channels.
- **Key features:**
  - Channels `stable` (from `main`) and `beta` (from `dev`, prereleases) per component, chosen in the hub UI (D9).
  - Staged rollout by hashing a random install id against `rolloutPercent`, and pulling a version from the catalog (D4, D9).
- **Exit criteria:** an installed hub on `beta` updates itself to a published `hub-v*` prerelease and back to stable on switching; switching a component to `beta` installs its latest prerelease and switching back offers the latest stable; with `rolloutPercent: 10` a simulated population of install ids gets the update at about 10%; a version pulled from the catalog is no longer offered.

### M7 — Analysis reliability

- **Goal:** every suggestion the hub returns lands in the document, and no crash leaves work in a wrong state.
- **Key features:**
  - Suggestions the task pane cannot place: it showed "No encontradas 1" at the MVP approval. Evidence: `known-good/mvp` open points. Whether the cause is the hub's anchor/context or the add-in's locator is not yet known.
  - Advisories left as follow-ups by the API v1 verifier ([`odd/tasks/hub-api-v1.md`](../odd/tasks/hub-api-v1.md) L6): `completePart` is not idempotent if the process dies between its commit and OpenWorkflow recording the step; a feedback whose `engine.start` throws stays pending; extra fields in the analysis request are ignored.
  - Null `tag` guards in the add-in (`cc.tag.startsWith` crashed the task pane), handed to the add-in team ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L57); confirm the fix is on the add-in's `main`.
- **Exit criteria (proposal):** each item above fixed with a regression test, or closed with the reason; an analysis of a real document shows zero unplaced suggestions.

### M8 — Product readiness

- **Goal:** users can run it day to day, understand what happens to their text, and get help.
- **Key features (all proposals unless noted):**
  - Privacy: the analyzed text and the style profile go to the provider the user chose through Pi ([architecture](architecture.md#from-analizar-y-sugerir-to-track-changes)); the hub and the task pane should say so before the first analysis.
  - Support diagnostics: the hub already writes logs (`word-session.log` in its logs folder, opened from the Server screen); an exportable diagnostics bundle (component versions, update history, logs, Word status) makes reports actionable. The bundle is part of the launcher plan's quality bar, not a proposal.
  - Telemetry: none today, and none should be added without an explicit opt-in.
  - Provider and model settings: the hub offers providers exactly as Pi does ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) S5); a clearer model choice per task is a UX question to research with users.
  - Deferred from the MVP (evidence: [`odd/tasks/mvp.md`](../odd/tasks/mvp.md) S2 "Out"): backups, fallback pools, Gemini safety settings, offline evals.
- **Exit criteria (proposal):** privacy notice shipped; a diagnostics bundle a user can export from the hub and attach to a report; each deferred MVP item either scheduled or dropped with a reason.

## Superseded

- **Shared release cadence for hub and add-in** (old M2): recording by hand which add-in commit each hub release bundles. Replaced by independent releases with `requires`/`provides` ranges (D2, D5).
- **Auto-update with electron-builder's updater** (old M4): now D10, delivered in M4: the hub is a signed catalog component and electron-updater only installs, from a loopback feed, the installer the update engine already verified; the server and the modules update through the update engine (D5).

## Accepted non-goals

Decided by the user on 2026-10-17 ([`odd/tasks/launcher-plan.md`](../odd/tasks/launcher-plan.md) S2, L4): these will not be done.

| Non-goal | Consequence |
|---|---|
| (a) Buying an Authenticode code-signing certificate for the hub installer. | Windows SmartScreen warns on the first install of the hub, and the installer carries no Authenticode signature (D10). Hub self-updates, server and module artifacts are still signed with our own keys and verified by the hub (D3, D10). |
| (b) Microsoft Marketplace or centralized deployment to load the add-in without the trigger window. | The trigger window stays: Word shows the trigger document for about a second per session, and hiding it stops the add-in from loading (`known-good/word-addin-loads`; [`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L51, L52). |

## World-class bar

What every launcher milestone is held to, beyond its own exit criteria ([`odd/tasks/launcher-plan.md`](../odd/tasks/launcher-plan.md), cross-cutting quality bar):

- **Fault injection.** The update engine has tests that kill it mid-install and feed it a corrupt download, a bad signature, an expired or older catalog, and a failing health check; each ends with a working installed version.
- **Rollback.** Every switch of a server or module version can go back to the previous one automatically, data included (D6, D7).
- **Signed everything.** No server, module or hub update byte is installed unless a signature from a key that the current, unexpired root-signed `keys.json` lists with the right role covers it, and a revocation (a new `keys.json` without the key) also disables an installed version (D3, D4, D10). Our signature covers hub updates too; the first hub installer's missing Authenticode signature is the one accepted exception (non-goal a).
- **Fresh catalog.** A scheduled job keeps the catalog valid with no content change, and an expired catalog never stops installed components (D4).
- **Observability.** Local structured logs, a visible update history, and an exportable diagnostics bundle; telemetry only with opt-in.
- **Contract tests.** The OpenAPI diff and the module contract run in CI, so a component cannot release something another installed component cannot use (D12).
- **Least privilege.** Module-scoped tokens: a module reaches only the API scopes it declares.
