# Hub API v1

Objective: replace the Mastra-shaped HTTP surface with an API designed for the hub and the add-in's new `HubAnalysisAdapter`.
Branch: `feat/hub-api-v1` (from `feat/mvp-ui` 6c7c6fc). Delivery: `ask-on-risk`. Test runner: `bun run test` (vitest), gate `bun run check`.

## Specs

- **S1** — "actualmente esa no es la idea. Actualmente la idea es que creen, si es necesario desde cero, su propia versión de backend con frontend. Eso les va a dar más libertad para hacer cosas que antes no podían." The hub API drops every Mastra leftover: the create-run/start pair, `inputData`, Mastra status names and the in-memory run map. The add-in's adapter is the only client; nothing else consumes the old routes.
- **S2** — "necesito que tú pienses una buena arquitectura de backend. No te me pases de vago." The design below is recorded before code, reviewed with the add-in team, and its decisions are kept in `docs/architecture.md`.
- **S3** — No lost profile updates: parallel chunks of one analysis, other analyses of the same document and feedback must not overwrite each other's profile changes. (Defect in the current design: each chunk run reads the profile at its start and writes it at its end.)
- **S4** — Runs survive a hub restart: an analysis started before a restart can still be read and finishes or fails visibly, never as an unexplained 404.
- **S5** — Every error the add-in can receive is JSON with a stable machine `code` and a human `detail` that carries the real cause, including a provider's own message. The hub's 401 included.
- **S6** — The add-in can tell before analyzing whether the hub can analyze at all (provider connected and model chosen), not only whether it answers.
- **S7** — The contract is published from the same zod schemas that validate it, so the add-in does not hand-copy types.

- **S8** — Every suggestion the hub returns already satisfies what the add-in checks today (`MastraAdapter.ts:394-431`): its anchor is inside its context, and a track-change carries `suggestedText`. A suggestion that fails is dropped by the hub and counted, not sent.
- **S9** — Feedback names the suggestion by the id the hub gave it, instead of re-sending the suggestion.

Assumptions: the add-in keeps splitting the document, because only it can map suggestions back to Word ranges (L4: up to 100,000 characters per chunk, paragraphs never split). Server-sent events, a profile editor and history are product wishes not decided by the add-in's user (L4), so v1 leaves them out; the analysis resource keeps per-chunk state so they can be added without changing it.

## Design

### Resources

`documentId` is the UUID the add-in stores inside the Word document (today's `documentUuid`).

| Method and path | Purpose |
|---|---|
| `GET /api/v1/status` | `{ version, analysis: { ready, reason?, model? } }`: whether a model is chosen (S6) |
| `GET /api/v1/documents/{documentId}` | Genre and style profile (Markdown, updatedAt); `404` before its first analysis |
| `POST /api/v1/documents/{documentId}/analyses` | `{ genre, chunks: [{ id, text }] }` → `202` analysis; `genre` is stored on the document |
| `GET /api/v1/analyses/{analysisId}` | Analysis with every chunk's status and suggestions so far |
| `POST /api/v1/analyses/{analysisId}/cancel` | Cancels the analysis and every chunk still running |
| `POST /api/v1/feedback` | `{ suggestionId, action: accept \| reject, comment? }` → `202` feedback (S9) |
| `GET /api/v1/feedback/{feedbackId}` | `{ status, outcome: updated \| ignored \| acknowledged, summary? }` |
| `GET` / `PUT /api/v1/preferences` | Standing correction instructions |
| `GET /api/v1/openapi.json` | The contract (S7) |

Analysis: `{ id, documentId, status: running | completed | partial | failed | canceled, chunks: [{ id, status: queued | running | completed | failed | canceled, suggestions?, dropped?, error? }], profile: pending | updated | unchanged | failed, createdAt, finishedAt? }`. `partial` means some chunks failed and the rest have suggestions. A suggestion is `{ id, context, anchor, justification, category, severity, type, suggestedText? }`; `id` is the hub's (S9).

No accounts: the task pane's hub token replaces better-auth sign-in, `/auth*` routes do not exist on the hub (one hub per Windows user).

Errors (S5): RFC 9457 `application/problem+json`, `{ type, title, status, detail, code }`; codes such as `unauthorized`, `validation_failed`, `not_found`, `no_model`, `provider_error`.

### Execution

- One `analysis` parent workflow per request runs one `analyze-chunk` child workflow per chunk with `Promise.all` (OpenWorkflow child workflows, documented), so the worker pool bounds parallelism and the parent has one durable point after all chunks: the profile update. A failed chunk is caught by the parent and recorded; the others continue.
- The profile is updated once per analysis, from every chunk's suggestions, not once per chunk (S3).
- Profile writes go through one per-document lock in the backend process, and each read-merge-write happens inside it, reading the profile current at that moment (S3). The hub runs one backend process, so an in-process lock is enough.
- Canceling marks the analysis canceled and cancels the parent and each chunk run, since OpenWorkflow does not cancel children with their parent.

### State

- The hub's database keeps the read model: `analysis`, `analysis_chunk` and `feedback` tables, written by the workflow steps. The HTTP layer reads these tables, never the engine's internals or a memory map (S4).
- OpenWorkflow keeps execution only. Engine run ids are stored on the rows that need cancelling.

### Layout

Feature folders: `analysis/` (workflows, schemas, prompts moved from `correction/`), `feedback/`, `documents/` (profile, lock), `preferences/`; `ports/`; `adapters/http/` with one route module per feature. `workflow-routes.ts` and the Mastra status names go.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2 | inline | design sent to the user and the add-in team; waiting for their answers (L2) | — |

## Log

- **L1** (2026-10-17, user): "Claro, o sea, mira, yo sé que intentaron hacerlo de maestra por hacer compatible lo más rápido posible. Pero actualmente esa no es la idea. Actualmente la idea es que creen, si es necesario desde cero, su propia versión de backend con frontend. Eso les va a dar más libertad para hacer cosas que antes no podían. Y sobre todo, necesito que tú pienses una buena arquitectura de backend. No te me pases de vago."
- **L2** (2026-10-17): asked the add-in session (`stylistic-addon-78`) for its chunking, polling, `IAnalysisPort`, document context, feedback timing and the features Mastra blocked. Its user decided the add-in drops Mastra and writes `HubAnalysisAdapter`; the add-in fixed the null-tag crash in its working tree (four tests, no live stack trace).
- **L3** (2026-10-17): evidence for the design. OpenWorkflow 0.11 runs child workflows in parallel with `Promise.all`; a child's failure fails the parent step; a parent's timeout does not cancel the child. Current defects found: per-chunk profile read-at-start / write-at-end (lost updates), in-memory run map (404 after restart). To verify in T2 with a test before relying on it: that a parent waiting on `step.runWorkflow` parks and frees its worker slot (the worker runs 4 at a time, `engine.ts:32`); otherwise 4 concurrent analyses would block their own chunks.
- **L4** (2026-10-17, add-in team, read from add-in main): chunks are packed paragraphs up to 100,000 characters (`chunker.ts:41-71`), so most documents are one chunk; one chunk at a time; poll every 1 s; suggestions applied only when every chunk is done; the payload actually sent is `{text, documentUuid, genero}` (title and processingConfig never sent); genre is a per-user setting defaulting to narrativa-literaria; feedback is fire-and-forget after each accept/reject; the add-in checks anchor-in-context and track-change `suggestedText`; suggestion ids are made on the client. It also calls better-auth (Google) and `/user/preferences`. Design changed: no SSE in v1, no document PUT (genre rides on the analysis), no `processingConfig`, hub-issued suggestion ids with feedback by id (S9), hub-side suggestion checks (S8).
