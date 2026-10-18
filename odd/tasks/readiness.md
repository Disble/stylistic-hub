# M8 — Product readiness (hub side)

Objective: roadmap M8 (docs/roadmap.md), the parts the hub can ship without the add-in repo or the user: privacy notice in the hub, an exportable diagnostics bundle, and a decision for each deferred MVP item. Branch `feature/readiness` from `dev`. Runner: vitest; local gate `bun run check`. Delivery: work-unit commits merged `--no-ff` into `dev`.

## Specs

Exit criteria quoted from the roadmap (proposal): "privacy notice shipped; a diagnostics bundle a user can export from the hub and attach to a report; each deferred MVP item either scheduled or dropped with a reason."

- **S1 Privacy notice** — roadmap: "the analyzed text and the style profile go to the provider the user chose through Pi …; the hub and the task pane should say so before the first analysis." Hub side only: one short, plain sentence on the screen where the user chooses and signs in to a provider (and nowhere else), naming what leaves the machine (the text being analyzed and the document's style profile) and where it goes (the chosen provider), and that the hub sends nothing else anywhere (no telemetry). No consent gate, no new setting. The task pane's notice is handed to the add-in team with the exact sentence.
- **S2 Diagnostics bundle** — roadmap: "an exportable diagnostics bundle (component versions, update history, logs, Word status) makes reports actionable." A button on the Server screen ("Export diagnostics") opens a save dialog and writes one zip (yazl, already a dependency) holding: `summary.json` (hub version, OS, Electron/Node versions, server status as the Server screen shows it, Word integration status, components `state.json` contents), and the files of the hub's logs folder. It must never include credentials or tokens: not Pi's auth/credential files, not the hub token, not the hub CA private key, not environment variables; a test asserts the bundle's file list and that a planted token string in the hub's token source does not appear in any bundled byte. Logs are included as written; the dialog says the bundle contains the logs (which may hold excerpts of analyzed text) so the user decides before attaching it.
- **S3 Deferred MVP items** — roadmap: "Deferred from the MVP …: backups, fallback pools, Gemini safety settings, offline evals"; "Telemetry: none today, and none should be added without an explicit opt-in." Each one gets a line in docs/roadmap.md M8: scheduled (with the milestone) or dropped with a measured reason. Facts to use: database backups now exist (update-engine S1, `VACUUM INTO` before migrations) — decide whether that closes "backups" by reading what odd/tasks/mvp.md S2 meant by it. Do not build any of them.

**Out of scope:** telemetry, consent dialogs, provider/model settings UX (a research question), the task pane's notice (add-in team).

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1–S3 | delegated writer (context backstop; parallel with M6 in its own worktree) | open | |
| T2 | S2 | independent verifier (high-risk item 2: credentials must not leak into the bundle) | open | |

## Log

- **L1** (2026-10-18) User: "desde ahora tendrás que continuar con el resto por tu cuenta … cuidado con la sobreingeniería … las decisiones delicadas se las toma midiendo, y probando hipótesis falsables …".
