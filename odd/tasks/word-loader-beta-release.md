# Word loader beta release
Publish the verified Word-loader correction as a hub beta; feature/word-loader-startup -> dev.
Delivery: one fix unit, then release evidence; Bun/Vitest and CI; Risk: item 4 (async lifecycle), item 5 (publication).

## Specs

- S1: "release?" — selected delivery: "Publicar release beta".
- S2: Selected delivery description: "Preparar el commit y publicar una versión de prueba desde dev; incluye compilar el instalador."
- S3: "analiza si los fallido no son flaky tests" — preserve the observed diagnostic results when reporting verification.

## Tasks

- T1 [S1-S3] inline; done; repository release gates, normal hooks and existing independent concurrency verification passed; commit: 094ee92.
- T2 [S1-S2] inline; in_progress; merge the feature into dev with Git Flow and push the authorized beta release; commit: pending.
- T3 [S1-S3] inline; pending; observe CI completion and verify the published hub beta, installer and signed metadata; commit: pending.

## Log

- L1 Original report: "C:\Users\User\AppData\Local\Temp\gpTzT46n\pi-clipboard-57028720-d112-4e66-9686-f81ac5a0568c.png, C:\Users\User\AppData\Local\Temp\gpTzT46n\pi-clipboard-2774b865-0398-4dc1-88c5-d561847e0ab1.png, he abierto hoy un archivo de word y no se activó automáticamente la extensión, a pesar de tener en segundo plano el hub."
- L2 Correction authorization: "dale" after the proposal to apply the correction and a regression test without building or reinstalling.
- L3 Diagnostic request: "analiza si los fallido no son flaky tests".
- L4 Publication request: "release?". The user selected "Publicar release beta", with description "Preparar el commit y publicar una versión de prueba desde dev; incluye compilar el instalador." This authorizes the commit, beta publication and release build; no automatic installation is planned.
- L5 Existing correction: initial Word-loader restoration waits for module resolution and registration sync; late readiness restores it; revision guards prevent old status reads from overriding manual controls; server startup does not block restoration. Files: src/main/app.ts, src/main/app-word-session.test.ts, docs/architecture.md.
- L6 Existing proof: parent and independent reviewer pass 12 focused tests. Types, lint and formatting pass. A prior default-parallel suite failed with five 5000ms timeouts and two ENOTEMPTY cleanup errors. A sequential diagnostic matrix subsequently passed three targeted runs (73/73 each), the current complete suite with two workers (668/668), and the isolated baseline complete suite both by default and with two workers (661/661 each). No assertions, timeouts or permanent runner configuration were changed. Exact transient cause is unproven.
- L7 Routing: one dependent delivery unit, performed inline; no parallel writer trigger. Independent concurrency verification already closed both original findings. Publication will use the existing CI and semantic-release, not a custom release engine. Forecast: approximately 350 authored changed lines including the existing 243-line test and this record.
- L8 Starting state: feature/word-loader-startup at 65c9635d09033cfe1ba23ae4a1bb4a42ffd38798 (dev); origin is Disble/stylistic-hub; latest stable hub tag is hub-v1.1.0. The working tree contains only the correction and this tracking document. Next: run bun run check alone before committing.
- L9 Remote synchronization: default HTTPS fetch failed with "Empty reply from server" (exit 128). One command-local HTTP/1.1 attempt succeeded (exit 0), with dev and origin/dev identical at 65c9635. No permanent Git configuration was changed.
- L10 Release gate: bun run check passed (exit 0, 59 seconds), including formatting, lint, types, native coverage tiers and PowerShell parser validation. Coverage summary: statements 88.85%, branches 91.3%, functions 86.3%, lines 89.51%; all required per-file thresholds passed. The earlier default-run timeout evidence remains recorded in L6.
- L11 First commit attempt: pre-commit checks passed, including dharness, but commit-msg rejected the body with "body's lines must not be longer than 100 characters" (body-max-line-length); no commit was created. Correction: wrap the message body below 100 columns and rerun the normal hooks; source behavior is unchanged.
- L12 Fix committed as 094ee92, "fix(word): restore automatic loader after module readiness": 308 additions and 21 deletions. Format, types, coverage, dharness and commit-msg hooks passed. Committed-range assessment: native medium, escalated high for item 4; RDD off, reviewDue false. The required independent focused verification already passed on this same implementation (12/12 tests, both findings closed); no additional native review was started. This documentation update records T1 before integrating into dev.
