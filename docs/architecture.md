# Architecture

The Stylistic Hub backend uses **hexagonal architecture (ports and adapters)** with a **feature-first (screaming) folder layout**. It is not full Clean Architecture: the domain is small, so extra layers would add ceremony without benefit.

## Why hexagonal

- The design principle "do not reinvent the wheel" leaves a small domain: prompts, the suggestion schema and its rules, and the style profile. Everything else is an adopted tool.
- Each adopted tool must stay swappable, which is what an adapter behind a port gives us (OpenWorkflow → Mastra in-memory or `pi-durable`; Pi → another model runtime; `node:sqlite` → another store).
- It matches the add-in (`MastraAdapter`, `FeedbackAdapter`, `BetterAuthAdapter`, and the planned `HubAdapter`) and dhub (`domain/` + `adapters/`), so the monorepo shares one mental model.

## Ports: only where they pay off

Add a port only when a swap is plausible or tests need it. Do not wrap everything.

| Port | Adapter today | Reason |
|---|---|---|
| `LlmPort` (`structuredCall`) | Pi | Tests without network; isolates the forced-tool output |
| `WorkflowEngine` | OpenWorkflow | Plan B is real |
| `DocumentRepository` | `node:sqlite` | Workflow steps are tested without a database file |
| `PiProvider` (`src/main/pi-provider.ts`) | Pi `ModelRuntime` + `SettingsManager` | Pi breaks its API between releases; the IPC layer and the Provider screen only see this interface |

Hono (HTTP) and Electron are the outer driving side and get no port: they are entry points, not something we expect to replace.

## Rules

- Domain code imports no adopted tool (no Pi, OpenWorkflow, Hono or `node:sqlite` imports). zod is the exception: the schemas are domain, copied from stylistics-backend, and ports carry them.
- Adapters depend on ports, never the other way round.
- One adapter per adopted tool; keep it thin (glue, not engines).
- Any new port records its reason in the table above.

## Custom code and why

Per the "do not reinvent the wheel" principle, every piece we wrote ourselves is listed here.

| Code | Why no existing tool |
|---|---|
| `src/backend/adapters/http/host-allowlist.ts` | Hono ships CORS, IP restriction and bearer auth (all used) but no Host-header guard, which DNS rebinding requires. |
| `src/main/supervisor.ts` | No maintained package restarts Electron's `utilityProcess` with backoff; ~50 lines. |
| `src/backend/adapters/sqlite/database.ts` | `node:sqlite` has no migration helper; a `user_version` loop over append-only SQL strings is ~20 lines. Knex/Drizzle/umzug would add a dependency for one table. |
| `src/backend/adapters/http/workflow-routes.ts` | The add-in already speaks Mastra's workflow API through `@mastra/client-js`. Serving that slice (details, create-run, start, poll, cancel) keeps its `MastraAdapter` unchanged instead of writing a new client. Run ids live in memory: Mastra names a run before it starts, OpenWorkflow when it starts. |
| `src/backend/adapters/pi/pi-llm.ts` | Pi has no structured-output call and its neutral `toolChoice` is only `auto`/`none`. The adapter turns the zod schema into a `submit` tool (`z.toJSONSchema`), forces it with each API's own `toolChoice` (10 APIs) and validates with zod. |
| `src/shared/login/` | Not ours: copied from dhub (`src/main/domain/login.ts`, revision `bd94206`) with its tests. Pi exposes login as callbacks; this correlates them with UI prompts. Keep in sync with dhub. |
| `src/backend/adapters/tls/certificates.ts` | Thin use of `@peculiar/x509` to issue a local CA and a localhost leaf; mkcert/devcert need an external binary or admin rights. The CA's name constraints (only `localhost`, `127.0.0.1`, `::1`) are built with `@peculiar/asn1-x509`, which `@peculiar/x509` has no class for. |
| `src/main/word-integration.ts` | `office-addin-dev-settings` writes the same sideload registry value but brings Teams publishing, prompts and usage telemetry; the hub calls Windows' own `certutil -user -addstore Root` and `reg` instead (~60 lines). Registering alone does not make Word load the add-in; see the `word-session` row. |
| `src/main/word-session.ts` + `resources/word/word-session.ps1` | Word reads a sideloaded add-in only while it shows a document that refers to it, and forgets it when Word restarts (measured: a global template in Word's STARTUP folder, the `Wef` flags, a local trusted catalog and an invisible document all fail; see `odd/tasks/mvp.md` L35). No tool loads an add-in into a running Word, so a supervised PowerShell script creates a document from `Stylistic.docx` through Word's COM automation once per Word session, as soon as the user has a document of their own open (never on Word's start screen), closes it unsaved and brings the user's window back (~1 s; the window Word shows meanwhile is kept off screen, see the `stylistic-hook` row). The trigger document opens the add-in's task pane (that is what loads the add-in); the script closes that pane through Word's own "Close pane" button (UI Automation) before closing the document, because otherwise Word restores the pane, empty, in the user's documents next session, and it closes any such restored pane it finds. Every session is loaded once and the load is verified: the add-in's task pane opening inside the trigger is what proves the add-in started, so a trigger whose pane does not appear within 20 s (a cold WebView2 included) is closed and tried again, up to three times, and a session that will not load is reported in the log; the loader reaches the user's Word through the window the user sees (the accessibility API's `OBJID_NATIVEOM` on Word's document window) rather than `GetActiveObject`, which returns whichever Word registered first — a hidden Word another program automates, or one stuck closing, would otherwise keep Stylistic from loading without a trace; Words without a window are logged and ignored. It logs to `word-session.log` in the hub's logs folder; `Documents.Add` rather than `Open`, because opening would replace an untouched blank document the user just started. The only supported way to have Word install an add-in by itself is `Wef\AutoInstallAddins`, which requires a Microsoft Marketplace listing. Restarts reuse `supervisor.ts` (~45 + ~45 lines). |
| `native/word-hook/stylistic-hook.c` → `resources/word/stylistic-hook.dll` | Word shows the trigger document's window for about a second, and from outside its process nothing hides it: `ScreenUpdating`, moving it off screen, making it transparent (`WS_EX_LAYERED`), hiding it from a WinEvent hook and an invisible document all failed (screen measured: 33–77 % of the pixels change) or stop the add-in from loading. Word does not always create a window for a new document either: it may show a hidden frame it keeps ready, or create one. From inside Word both are reachable, so the loader installs this DLL as a `WH_CBT` hook on Word's threads only while it runs the trigger, and only while a named event the loader holds is set: the DLL subclasses every hidden `OpusApp` frame and every frame Word creates meanwhile (correcting the `CREATESTRUCT` before that window exists) and every frame Word is about to move, so the one shown for the trigger stays off screen, never maximizes, never activates and has no taskbar button; it also hooks threads Word creates after the trigger started — that is where the window can come from — and pulls a frame it adopted off screen if Word showed it first. The frames the user could see when the hook was armed are remembered and never touched, and every subclassed frame is restored as soon as the event is reset or gone. Measured with `scripts/word-probe/journey.ps1`: Word's hidden frame is forced 33–77 % → 0 ms on screen in the normal, windowless-Word and start-screen sessions; the only window left on screen is the empty one Word itself shows for about a second while a document opens from its start screen, before the trigger runs. Without the DLL the loader still works and Word shows the window. No library does this; ~330 lines of C, compiled with MinGW-w64 by `scripts/build-word-hook.ts` during `bun run dist` (`--trace` builds a diagnostic DLL that logs what it does to `%TEMP%\stylistic-hook.log`). |
| `Stylistic.docx` step in `scripts/bundle-addin.ts` | The document comes from `office-addin-dev-settings`' own template and placeholders (MIT, in `scripts/templates/`), filled with `adm-zip` as that tool does. Depending on the tool itself would add the Microsoft 365 Agents Toolkit CLI (83 MB, ~950 lockfile lines) for one 12 KB template (~20 lines). |
| `src/backend/adapters/http/addin-routes.ts` | `serveStatic` serves the add-in; the only custom part is putting the hub token into `taskpane.html` as a meta tag, so the task pane needs no sign-in. |

## Folder layout

The boundaries are enforced by fallow from the zones in `.dharness/fallow.jsonc`, run by `dharness check` on every commit.

```
src/backend/
  correction/   # stylistic-workflow: prompts, schema, suggestion rules
  feedback/     # feedback-workflow
  profile/      # per-document style profile
  ports/        # LlmPort, WorkflowEngine, repositories, ProviderAuth
  adapters/     # pi/, openworkflow/, sqlite/, http/ (Hono)
```
