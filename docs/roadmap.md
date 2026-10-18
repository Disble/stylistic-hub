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
- **Exit criteria:** CI green on `main` and `dev` in both repos; a pull request that removes a field from an API v1 response fails CI; an add-in build missing `manifest.xml` or `</head>` fails the add-in's CI; one `release:server` and one `release:hub` published from the remote.

### M3 — Signed releases and catalog

- **Goal:** every server and module release is a signed, self-describing artifact, and the hub can tell a genuine, current catalog from a forged, old or frozen one.
- **Key features:**
  - Release artifact: zip plus `component.json` (`id`, `kind`, `version`, `channel`, `sha256`, `size`, `requires`, `provides`, release notes URL) as GitHub Release assets of each component's repo (D2).
  - Own signing: ed25519 detached signatures over `component.json`, private key only in CI secrets, a keyring with key ids embedded in the hub, revoked key ids in the catalog (D3).
  - Signed `catalog.json` in the hub repo, changed through a reviewed PR, with `serial`, `expires`, `rolloutPercent` and version blocking (D4, D12).
  - A dev signing key and a local catalog file for development (D12).
- **Exit criteria:** CI publishes a signed server artifact and a signed add-in artifact; verification tests reject a tampered zip (sha256 mismatch), a tampered `component.json` (bad signature), a signature by a revoked key id, a catalog with a lower `serial` than the last seen one, and an expired catalog; a key rotation is rehearsed end to end (new key in the keyring, old key id revoked).

### M4 — Update engine and server channel

- **Goal:** the server updates on its own, without a hub reinstall, and a bad server version rolls back by itself without losing data.
- **Key features:**
  - Update engine in the hub's main process: periodic checks, resumable download to staging, verification, compatibility resolution, atomic install into `components/<id>/<version>/` with a `current` pointer, previous version kept, zip-slip guard (D5).
  - The server forked from `components/server/<current>/` instead of the hub's own build (D1); `--server <dir>` for development (D12).
  - Health check on `/api/v1/status` and crash-loop detection by `supervisor.ts`, with automatic rollback, the reason recorded, and the bad version never retried until a newer one appears (D6).
  - Server data safety: expand/contract migrations as a rule, a SQLite copy before a higher `schemaVersion` starts, restore on rollback, downgrade below the schema refused without a backup (D7). Today `database.ts` already refuses a database written by a newer schema.
  - Local structured logs and an update history (quality bar).
- **Exit criteria:** an installed hub moves from one `server-v*` to the next from the catalog, with no reinstall; fault-injection tests pass for: the hub killed mid-install (the previous version still runs, the next check resumes or restarts), a corrupt download, a bad signature, an expired or older catalog, an update set whose API range breaks an installed module (refused), and a server that fails its health check or crash-loops (rolled back, database restored to the copy, version marked bad); a migration that drops a column read by the previous release fails a check (**proposal**: how the expand/contract rule is checked).

### M5 — Module library and add-in delivery

- **Goal:** the Word add-in is a module the hub downloads, updates and rolls back like the server, and the installer carries nothing but the hub.
- **Key features:**
  - Each module served at `/m/<id>/` with today's versioned asset URLs and `Cache-Control` (`bef61c1`); Word re-registered only when the manifest identity changes; a new version applies on the next task pane open; `/api/v1/modules` lets the task pane offer a reload (D8).
  - Module health check: manifest and task pane served after the switch, rollback otherwise (D6).
  - Library UI: one card per component with versions, channel, progress, release notes, install, update, repair, uninstall and roll back, plus the update history; the first run downloads the server and the modules the user picks (D11).
  - Module-scoped tokens instead of the one shared hub token: a module reaches only the API scopes it declares (quality bar).
  - `--module <id>=<dir>` for development, generalizing today's `--addin <dir>` (D12).
  - Retire the hub's manifest shell (`resources/addin-shell/manifest.json`), which exists because the add-in manifest carried Microsoft's sample strings ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L50); the add-in's `main` now has `6c8abc0 fix(manifest): use Stylistic's own identity texts`. **Proposal**; with modules released from their own repo, the production identity belongs to the module's release.
- **Exit criteria:** a fresh install from a hub-only installer reaches a working "Analizar y sugerir" after the first-run download; an add-in update reaches Word on the next task pane open with no re-registration and no hub reinstall; a module whose task pane is not served after the switch is rolled back; a module token is refused by an API scope the module did not declare.

### M6 — Hub self-update, channels and rollout

- **Goal:** the hub keeps itself current, and each component can be tested on `beta` and rolled out gradually before everyone gets it.
- **Key features:**
  - Hub self-update with electron-updater from the hub's GitHub Releases, unsigned (non-goal S2 a), with the same channels (D10).
  - Channels `stable` (from `main`) and `beta` (from `dev`, prereleases) per component, chosen in the hub UI (D9).
  - Staged rollout by hashing a random install id against `rolloutPercent`, and pulling a version from the catalog (D4, D9).
- **Exit criteria:** an installed hub updates itself from a published `hub-v*` release; switching a component to `beta` installs its latest prerelease and switching back offers the latest stable; with `rolloutPercent: 10` a simulated population of install ids gets the update at about 10%; a version pulled from the catalog is no longer offered.

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
- **Auto-update with electron-builder's updater** (old M4): now D10, and only for the hub shell; the server and the modules update through the update engine (D5).

## Accepted non-goals

Decided by the user on 2026-10-17 ([`odd/tasks/launcher-plan.md`](../odd/tasks/launcher-plan.md) S2, L4): these will not be done.

| Non-goal | Consequence |
|---|---|
| (a) Buying an Authenticode code-signing certificate for the hub installer. | Windows SmartScreen warns on the first install of the hub, and hub self-updates are unsigned (D10). Server and module artifacts are still signed with our own keys (D3). |
| (b) Microsoft Marketplace or centralized deployment to load the add-in without the trigger window. | The trigger window stays: Word shows the trigger document for about a second per session, and hiding it stops the add-in from loading (`known-good/word-addin-loads`; [`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L51, L52). |

## World-class bar

What every launcher milestone is held to, beyond its own exit criteria ([`odd/tasks/launcher-plan.md`](../odd/tasks/launcher-plan.md), cross-cutting quality bar):

- **Fault injection.** The update engine has tests that kill it mid-install and feed it a corrupt download, a bad signature, an expired or older catalog, and a failing health check; each ends with a working installed version.
- **Rollback.** Every switch of a server or module version can go back to the previous one automatically, data included (D6, D7).
- **Signed everything.** No server or module byte runs unless a signature from a non-revoked key in the hub's keyring covers it (D3, D4). The hub installer is the one accepted exception (non-goal a).
- **Observability.** Local structured logs, a visible update history, and an exportable diagnostics bundle; telemetry only with opt-in.
- **Contract tests.** The OpenAPI diff and the module contract run in CI, so a component cannot release something another installed component cannot use (D12).
- **Least privilege.** Module-scoped tokens: a module reaches only the API scopes it declares.
