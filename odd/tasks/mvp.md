# MVP — Stylistic Hub end to end

Objective: the smallest working slice — install hub → connect a provider → add Stylistic to Word → analyze → Track Changes → feedback.
Branch: `feat/mvp` · Delivery: `ask-on-risk` · Test runner: vitest (`bun run test`).

## Specs

- **S1 — Reuse before building.** "aquí no reinventamos la rueda a menos que no haya otra opción. Es decir, usaremos siempre que esté disponible alguna herramienta que alguien más ya haya hecho." Rules in `AGENTS.md`; every custom piece records its reason.
- **S2 — MVP journey.** "ver lo que sería un MVP en el canvas para ver cómo se iría moviendo todo en la práctica." Scope = the six steps of the canvas MVP page (install hub, connect provider, add to Word, analyze, review Track Changes, feedback). Out: signing, auto-update, backups, fallback pools, Gemini safety settings, offline evals.
- **S3 — Same workflows.** "crear los mismos exactos workflows de Mastra que se hicieron para stilistycs backend y replicarlos, pero con la nueva arqitectura que estamos planteando." `stylistic-workflow` (load-author-profile → preference-guided-correction → correct-text → update-profile) and `feedback-workflow` (load-author-profile → process-feedback), same step ids, prompts and suggestion schema.
- **S4 — No users.** "estoy considerando eliminarlos en favor de un hub unico por computador unido a Pi" · "sería una app sin users". One hub per Windows user; per-install token; loopback only.
- **S5 — Providers as Pi offers them.** "Deja tal cual como ofrece Pi". No hub-side restrictions on subscription sign-ins or API keys.
- **S6 — Per-component versions.** "sería bueno que cada componente tenga su propio versionamiento, add-in ya la tiene, pero me faltaría Local server". Local server starts at 0.0.1.
- **S7 — Validate risky premises inside the MVP.** "2. Eso se hace en la MVP. 3. También se valida en la MVP." Forced-tool structured output per provider and the hub-served task pane in Word's WebView2 are validated as part of their tasks, not as separate phases.
- **S8 — Project setup.** "haz git init y configura todo el proyecto como el dios de la programación manda."
- **S9 — Architecture.** Hexagonal, feature-first, per `docs/architecture.md`.

## Tasks

| ID | Specs | Task | Route | Status | Evidence |
|---|---|---|---|---|---|
| T1 | S1, S8, S9 | Tooling and Electron shell skeleton (bun, electron-vite 5, TS, vitest, eslint, prettier, lefthook, electron-builder) | inline | in progress | |
| T2 | S4, S7 | Backend `utilityProcess` + supervisor; Hono on `https://localhost:3000` with local CA, Host allowlist, token, loopback guards | inline | todo | |
| T3 | S3, S4 | Storage: `node:sqlite`, `user_version` migrations, repositories | inline | todo | |
| T4 | S5, S6 | Pi `ModelRuntime` in `userData/pi`; provider login and model choice; Provider screen | inline | todo | |
| T5 | S3, S7 | `LlmPort.structuredCall` (forced submit tool) validated against each connected provider | inline | todo | |
| T6 | S3 | `WorkflowEngine` on OpenWorkflow; start/poll/cancel routes; `stylistic-workflow` | inline | todo | |
| T7 | S3 | `feedback-workflow` and profile update | inline | todo | |
| T8 | S2, S7 | Word: serve add-in from hub, HKCU registration, `HubAdapter` in stylistic-addon; validate in WebView2 | inline | todo | |
| T9 | S2, S6 | Renderer screens Home, Word, Server per canvas, with per-component versions | inline | todo | |
| T10 | S2 | Unsigned per-user NSIS installer | inline | todo | |

## Log

- **L1 (2026-10-15, user):** "Pienso que ya estamos listos para hacer la MVP, qué dices?"
- **L2 (2026-10-15, user):** "1. Pero estas seguro de usar Mastra? A mí no me convence del todo para nuestro caso. 2. Eso se hace en la MVP. 3. También se valida en la MVP. // Pero tanto miedo te da, puedes hacer dos PoCs para 2 y 3 antes, pero pienso ya puedes intentarlas en la MVP. // Claro, haz git init y configura todo el proyecto como el dios de la programación manda."
- **L3 (decision):** Mastra is dropped as plan B (76 MB, 30 deps, storage on an internal interface, weekly breaking releases). If OpenWorkflow fails inside the `utilityProcess`, the fallback is a small runner behind the `WorkflowEngine` port, justified by AGENTS.md rule 2: the remaining candidates (`pi-durable`, Effect workflow) are marked experimental or unstable.
- **L4 (decision):** toolchain mirrors dhub, but respects peer ranges: electron-vite 5.0.0 requires vite ≤ 7, so vite 7.3.7 + @vitejs/plugin-react 5.2.0; typescript-eslint requires TS < 6.1, so TypeScript 5.9.3.
