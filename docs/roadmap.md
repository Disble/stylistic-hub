# Roadmap

Where Stylistic stands and what separates it from an official product. How the system fits together: [architecture](architecture.md).

Every item cites where it comes from. **Proposal** marks an item or a grouping that no log entry or user decision asks for yet; the order of the milestones is a proposal too. The source documents are the feature documents in [`odd/tasks/`](../odd/tasks/) and the `known-good/*` tags (`git tag -n99 'known-good/*'`).

## Reached

| Milestone | Date | What it proves |
|---|---|---|
| `known-good/word-addin-loads` | 2026-10-16 | The hub's own loader makes Word load the add-in in the user's own document (Stylistic group in the Home tab, task pane opens), without injecting anything into Word. |
| `known-good/mvp` | 2026-10-17 | MVP approved by the user: "Analizar y sugerir" analyzes the selection through the hub's own backend (API v1, durable workflows, SQLite) and the task pane applies the suggestions as track changes and comments. |

## Next milestones

### M1 — Product foundation (in progress)

- **Goal:** one trunk and one way of working before the product grows. Source: [`odd/tasks/product-foundation.md`](../odd/tasks/product-foundation.md) S1–S5.
- **Key features:** all branches merged into `main`; Git Flow with `dev` as the development branch and `main` for releases ([Git Flow](git-flow.md)); a `release` skill that builds the Windows installer locally; this roadmap and the system overview in [architecture](architecture.md); a local installer of the latest version.
- **Exit criteria:** S1–S5 of that document checked off with their evidence.

### M2 — Shared delivery

- **Goal:** what reaches `main` is checked by a machine, and both repositories ship together.
- **Key features:**
  - CI on the remote (`github.com/Disble/stylistic-hub`, where `main`, `dev` and the `known-good/*` tags were pushed on 2026-10-17) that runs `bun run check` and `dharness check` on every push and pull request. Evidence: today the checks run only in local hooks ([development](development.md#git-hooks-and-the-dharness-gate)). CI itself is a **proposal**.
  - Versioned releases with semantic-release (`hub-vX.Y.Z`, `server-vX.Y.Z`, test releases on `beta`). Evidence: configured and probed in a scratch clone; the remote now exists, but no release has run against it yet ([`odd/tasks/release.md`](../odd/tasks/release.md) L4, L6); "release commits under the real lefthook hooks" were never probed (L8).
  - The add-in repository merges its hub work into its `main`: `feat/hub-analysis-adapter` (88a3102, the adapter bundled at the MVP) lacks `build:hub`, which lives only on the unmerged `feat/hub-adapter` (5cd3a98). Evidence: `known-good/mvp` open points; [`odd/tasks/addin-packaging.md`](../odd/tasks/addin-packaging.md) L3.
  - Retire the hub's manifest shell (`resources/addin-shell/manifest.json`), which exists because the add-in manifest carried Microsoft's sample strings ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L50). The add-in's `main` now has `6c8abc0 fix(manifest): use Stylistic's own identity texts`, so the shell may only duplicate it once that reaches the bundled branch. Retiring it is a **proposal**; the production add-in id rewrite in `stage-prod-addin.ts` stays either way.
  - A shared release cadence for hub and add-in (which add-in commit each hub release bundles). **Proposal**: today the bundled add-in commit is recorded only by hand in tags and logs.
- **Exit criteria (proposal):** CI green on `main` and `dev`; a real `release:server` and `release:hub` from the remote; the hub bundles the add-in from the add-in's `main` with `build:hub`.

### M3 — Analysis reliability

- **Goal:** every suggestion the hub returns lands in the document, and no crash leaves work in a wrong state.
- **Key features:**
  - Suggestions the task pane cannot place: it showed "No encontradas 1" at the MVP approval. Evidence: `known-good/mvp` open points. Whether the cause is the hub's anchor/context or the add-in's locator is not yet known.
  - Advisories left as follow-ups by the API v1 verifier ([`odd/tasks/hub-api-v1.md`](../odd/tasks/hub-api-v1.md) L6): `completePart` is not idempotent if the process dies between its commit and OpenWorkflow recording the step; a feedback whose `engine.start` throws stays pending; extra fields in the analysis request are ignored.
  - Null `tag` guards in the add-in (`cc.tag.startsWith` crashed the task pane), handed to the add-in team ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L57); confirm the fix is on the add-in's `main`.
- **Exit criteria (proposal):** each item above fixed with a regression test, or closed with the reason; an analysis of a real document shows zero unplaced suggestions.

### M4 — Distribution

- **Goal:** someone other than the developer can install, trust and keep the hub up to date.
- **Key features:**
  - Signed installer: the NSIS installer is unsigned today ([development](development.md), `bun run dist`), so Windows SmartScreen warns on it. Signing was out of the MVP's scope ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) S2). The choice of certificate is a **proposal** to research.
  - Auto-update: out of the MVP's scope (same S2); `AGENTS.md` assigns updates to Electron's standard tooling, so electron-builder's updater is the default candidate (**proposal**). It needs the versioned releases of M2 and a place to publish them.
  - The trigger window: Word shows the trigger document for about a second per session, and hiding it stops the add-in from loading (`known-good/word-addin-loads`; [`odd/tasks/mvp.md`](../odd/tasks/mvp.md) L51, L52). No window at all needs a supported deployment (Microsoft Marketplace or centralized deployment), which costs no money but needs a publicly hosted task pane talking to the local hub, an architecture change away from local-first (L52). **User decision pending**; until then the one-second window is the documented behavior.
- **Exit criteria (proposal):** a signed installer that installs without a SmartScreen block; an installed hub that updates itself from a published release; a recorded decision on the deployment path.

### M5 — Product readiness

- **Goal:** users can run it day to day, understand what happens to their text, and get help.
- **Key features (all proposals unless noted):**
  - Privacy: the analyzed text and the style profile go to the provider the user chose through Pi ([architecture](architecture.md#from-analizar-y-sugerir-to-track-changes)); the hub and the task pane should say so before the first analysis.
  - Support diagnostics: the hub already writes logs (`word-session.log` in its logs folder, opened from the Server screen); a one-click diagnostic bundle (versions, logs, Word status) would make reports actionable.
  - Telemetry: none today, and none should be added without an explicit opt-in.
  - Provider and model settings: the hub offers providers exactly as Pi does ([`odd/tasks/mvp.md`](../odd/tasks/mvp.md) S5); a clearer model choice per task is a UX question to research with users.
  - Deferred from the MVP (evidence: [`odd/tasks/mvp.md`](../odd/tasks/mvp.md) S2 "Out"): backups, fallback pools, Gemini safety settings, offline evals.
- **Exit criteria (proposal):** privacy notice shipped; a diagnostic bundle a user can attach to a report; each deferred MVP item either scheduled or dropped with a reason.
