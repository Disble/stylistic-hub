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
| `ProfileRepository`, `RunStore` | `node:sqlite` | Tests with an in-memory database |
| `ProviderAuth` | Pi login | Pi breaks its API between releases |

Hono (HTTP) and Electron are the outer driving side and get no port: they are entry points, not something we expect to replace.

## Rules

- Domain code imports no adopted tool (no Pi, OpenWorkflow, Hono or `node:sqlite` imports).
- Adapters depend on ports, never the other way round.
- One adapter per adopted tool; keep it thin (glue, not engines).
- Any new port records its reason in the table above.

## Folder layout

```
backend/src/
  correction/   # stylistic-workflow: prompts, schema, suggestion rules
  feedback/     # feedback-workflow
  profile/      # per-document style profile
  ports/        # LlmPort, WorkflowEngine, repositories, ProviderAuth
  adapters/     # pi/, openworkflow/, sqlite/, http/ (Hono)
```
