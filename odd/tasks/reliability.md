# M7 — Analysis reliability

Objective: roadmap M7 (docs/roadmap.md): "every suggestion the hub returns lands in the document, and no crash leaves work in a wrong state." Branch `feature/reliability` from `dev`. Runner: vitest; local gate `bun run check`. Delivery: work-unit commits merged `--no-ff` into `dev`.

## Specs

Exit criteria (roadmap, proposal): "each item above fixed with a regression test, or closed with the reason; an analysis of a real document shows zero unplaced suggestions."

- **S1** "`completePart` is not idempotent if the process dies between its commit and OpenWorkflow recording the step" — make a replayed `completePart` for an already completed part a no-op that returns the same outcome (no double counting, no duplicate suggestions). Regression test replays the step.
- **S2** "a feedback whose `engine.start` throws stays pending" — the feedback ends in its failed state with the error message, observable through the API. Regression test.
- **S3** "extra fields in the analysis request are ignored" — decide by measurement, not taste: (a) read what the add-in actually sends (stylistic-addon, read only: its hub adapter on the local branch `feat/hub-analysis-adapter`, `c904ad9`) and compare with `AnalysisRequest`; (b) run oasdiff (as `.github/workflows/ci.yml` api-contract does) on the v1 document before/after making the request strict. Falsifiable hypothesis H3: "rejecting unknown request fields breaks no current client and oasdiff reports no ERR". If H3 holds, reject them with `validation_failed` like `PUT /preferences` does; if it fails, keep ignoring them and close the item with the measured reason.
- **S4** "No encontradas 1" at the MVP approval: find whether the cause is the hub's anchor/context or the add-in's locator. Read-only on the add-in. Produce a falsifiable root-cause hypothesis with code evidence (path:line on both sides); if the hub side is at fault, fix it with a regression test; if not, close it here with the evidence and hand it to the add-in team. Without the user's document, "zero unplaced suggestions on a real document" stays pending the maintainer.
- **S5** Null `tag` guards in the add-in (`cc.tag.startsWith` crashed the task pane): confirm, read only, whether the guard is on the add-in branch the hub bundles; report path:line or hand it over.

**Out of scope:** UI changes, new endpoints, prompt changes beyond what S4's root cause strictly requires.

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1–S5 | delegated writer (context backstop) | open | |
| T2 | all | verifier only if a Risk line names a high-risk item | open | |

## Log

- **L1** (2026-10-18) User: "desde ahora tendrás que continuar con el resto por tu cuenta … cuidado con la sobreingeniería … las decisiones delicadas se las toma midiendo, y probando hipótesis falsables …".
