# Architecture

The Stylistic Hub backend uses **hexagonal architecture (ports and adapters)** with a **feature-first (screaming) folder layout**. It is not full Clean Architecture: the domain is small, so extra layers would add ceremony without benefit.

## Why hexagonal

- The design principle "do not reinvent the wheel" leaves a small domain: prompts, the suggestion schema and its rules, and the style profile. Everything else is an adopted tool.
- Each adopted tool must stay swappable, which is what an adapter behind a port gives us (OpenWorkflow → Mastra in-memory or `pi-durable`; Pi → another model runtime; `node:sqlite` → another store).
- It matches the add-in (whose own `HubAnalysisAdapter` speaks [API v1](api.md)) and dhub (`domain/` + `adapters/`), so the monorepo shares one mental model.

## Ports: only where they pay off

Add a port only when a swap is plausible or tests need it. Do not wrap everything.

| Port | Adapter today | Reason |
|---|---|---|
| `LlmPort` (`structuredCall`) | Pi | Tests without network; isolates the forced-tool output |
| `WorkflowEngine` | OpenWorkflow | Plan B is real; the engine only executes, it holds no result the API reads |
| `DocumentRepository` | `node:sqlite` | Documents and their style profiles |
| `AnalysisRepository` | `node:sqlite` | The read model of analyses, chunks and suggestions the API serves, apart from the engine's own tables |
| `FeedbackRepository` | `node:sqlite` | Feedback and what became of it |
| `PiProvider` (`src/main/pi-provider.ts`) | Pi `ModelRuntime` + `SettingsManager` | Pi breaks its API between releases; the IPC layer and the Provider screen only see this interface |

Hono (HTTP) and Electron are the outer driving side and get no port: they are entry points, not something we expect to replace.

## Rules

- Domain code imports no adopted tool (no Pi, OpenWorkflow, Hono or `node:sqlite` imports). zod is the exception: the schemas are domain, copied from stylistics-backend, and ports carry them.
- Adapters depend on ports, never the other way round.
- One adapter per adopted tool; keep it thin (glue, not engines).
- Any new port records its reason in the table above.
- A workflow body never catches what a step throws: OpenWorkflow retries a failed step by replaying the run and pauses a run by throwing. Work whose final failure must be recorded (a part, the profile update, processing feedback) runs as a child workflow, whose failure is final and comes back as a `ChildResult`.
- The profile is written once per analysis and once per feedback, through `profile-updater.ts`, which serializes writes per document so no update is lost.
- Tests that run workflows and services over the real SQLite adapters are named `*.integration.test.ts` and live in their own fallow zone, which may import adapters; rules such as how an analysis settles live in the repository's SQL, and a fake would duplicate them.

## Custom code and why

Per the "do not reinvent the wheel" principle, every piece we wrote ourselves is listed here.

| Code | Why no existing tool |
|---|---|
| `src/backend/adapters/http/host-allowlist.ts` | Hono ships CORS, IP restriction and bearer auth (all used) but no Host-header guard, which DNS rebinding requires. |
| `src/main/supervisor.ts` | No maintained package restarts Electron's `utilityProcess` with backoff; ~50 lines. |
| `src/backend/adapters/sqlite/database.ts` | `node:sqlite` has no migration helper; a `user_version` loop over append-only SQL strings is ~20 lines. Knex/Drizzle/umzug would add a dependency for one table. |
| `src/backend/adapters/http/api-v1.ts` + `problem.ts` | The routes, their validation and `GET /api/v1/openapi.json` come from `@hono/zod-openapi` over the domain's zod schemas; ours is only the route table and the RFC 9457 problem body (~10 lines), which Hono does not ship. |
| `src/backend/profile/profile-updater.ts` | A promise queue per document (~25 lines) so concurrent analyses and feedback never overwrite each other's profile; a lock library would add a dependency for one in-process map. |
| `src/backend/analysis/parts.ts` | Splits a chunk into parts at paragraph ends so a 100k-character chunk fits a model call, and drops suggestions whose anchor is not in their context (~40 lines); text splitters such as LangChain's cut paragraphs and bring a framework. |
| `src/backend/adapters/pi/pi-llm.ts` | Pi has no structured-output call and its neutral `toolChoice` is only `auto`/`none`. The adapter turns the zod schema into a `submit` tool (`z.toJSONSchema`), forces it with each API's own `toolChoice` (10 APIs) and validates with zod. |
| `src/shared/login/` | Not ours: copied from dhub (`src/main/domain/login.ts`, revision `bd94206`) with its tests. Pi exposes login as callbacks; this correlates them with UI prompts. Keep in sync with dhub. |
| `src/backend/adapters/tls/certificates.ts` | Thin use of `@peculiar/x509` to issue a local CA and a localhost leaf; mkcert/devcert need an external binary or admin rights. The CA's name constraints (only `localhost`, `127.0.0.1`, `::1`) are built with `@peculiar/asn1-x509`, which `@peculiar/x509` has no class for. |
| `src/main/word-integration.ts` | `office-addin-dev-settings` writes the same sideload registry value but brings Teams publishing, prompts and usage telemetry; the hub calls Windows' own `certutil -user -addstore Root` and `reg` instead (~60 lines). Registering alone does not make Word load the add-in; see the `word-session` row. |
| `src/main/word-session.ts` + `resources/word/word-session.ps1` | Word reads a sideloaded add-in only while it shows a document that refers to it, and forgets it when Word restarts (measured: a global template in Word's STARTUP folder, the `Wef` flags, a local trusted catalog and an invisible document all fail; see `odd/tasks/mvp.md` L35). No tool loads an add-in into a running Word, so a supervised PowerShell script creates a document from `Stylistic.docx` through Word's COM automation once per Word session, as soon as the user has a document of their own open (never on Word's start screen), closes it unsaved and brings the user's window back. What decides the load is the add-in's own UI in a window of that Word — never a `MsoWorkPane`, which Word creates from the trigger's own `taskpanes.xml` even when the add-in never starts — so a session whose UI does not appear within the wait is reported as not loaded, with the reason (`the trigger's task pane opened, but the add-in's UI is not in the window`; `Word asked the hub for the add-in's page, but the add-in's UI is not in the window`; `Word started nothing`), and tried again after five minutes; a session whose window already shows the UI gets no trigger at all. The trigger document opens the add-in's task pane — that is what loads the add-in — and the script closes that pane through Word's own "Close pane" button (UI Automation) before closing the document, because otherwise Word restores the pane, empty, in the user's documents next session, and it closes any such restored pane it finds. It reaches the user's Word through the window the user sees (the accessibility API's `OBJID_NATIVEOM` on Word's document window) rather than `GetActiveObject`, which returns whichever Word registered first, and a Word without a window is logged and ignored. It logs to `word-session.log` in the hub's logs folder; `Documents.Add` rather than `Open`, because opening would replace an untouched blank document the user just started. The only supported way to have Word install an add-in by itself is `Wef\AutoInstallAddins`, which requires a Microsoft Marketplace listing. Word shows the trigger document in a second window for about a second while the loader opens it, waits and closes it, and nothing hides that window: and that window is what starts the add-in: hiding it stops the load whether the hider runs inside Word (the retired hook) or in the loader's own process (measured, `odd/tasks/mvp.md` L52), so the loader prefers the add-in (user measurement, `odd/tasks/mvp.md` L51). It installs nothing into Word: the `WH_CBT` hook DLL that used to hide the trigger window was measured to be the reason the add-in stopped loading, and is retired (`odd/tasks/mvp.md` L49 and L50). Every mechanism that was tried before this one, and the measurement that discarded it, is recorded in `reports/Cargar Stylistic en Word (postmortem).md`. Restarts reuse `supervisor.ts` (~45 + ~45 lines). |
| `Stylistic.docx` step in `scripts/bundle-addin.ts` | The document comes from `office-addin-dev-settings`' own template and placeholders (MIT, in `scripts/templates/`), filled with `adm-zip` as that tool does. Depending on the tool itself would add the Microsoft 365 Agents Toolkit CLI (83 MB, ~950 lockfile lines) for one 12 KB template (~20 lines). |
| `src/backend/adapters/http/addin-routes.ts` | `serveStatic` serves the add-in; the only custom part is putting the hub token into `taskpane.html` as a meta tag, so the task pane needs no sign-in. |

## Folder layout

The boundaries are enforced by fallow from the zones in `.dharness/fallow.jsonc`, run by `dharness check` on every commit.

```
src/backend/
  analysis/     # analysis workflows and service: prompts, schemas, parts, suggestion rules
  feedback/     # feedback workflows and service
  profile/      # per-document style profile
  ports/        # LlmPort, WorkflowEngine, repositories, ProviderAuth
  adapters/     # pi/, openworkflow/, sqlite/, http/ (Hono)
```
