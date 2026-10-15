# stylistic-hub — Agent Instructions

Windows desktop hub for Stylistic: installs the Word add-in and runs the local backend on the same computer.

Root cascade: `../AGENTS.md` → this file → `CLAUDE.md`.

## Design principle: do not reinvent the wheel

We only build something ourselves when no maintained tool already solves it.

- **Default to adoption.** Before writing any non-trivial component, look for an existing library, framework, or tool that already does it, and use it.
- **Established precedents:**
  - **Pi** (`@earendil-works/pi-*`) owns everything about LLM providers: catalog, OAuth and API-key login, credentials, model calls, retries, usage and cost.
  - **Electron** owns the desktop app: windows, tray, processes, packaging and updates (with its standard tooling).
  - **Whatever replaces Mastra** for workflows must follow the same rule: pick an existing orchestration tool before writing our own runner.
- **Custom code is the exception.** It is acceptable only when one of these holds, and the reason must be written down in the proposal or the feature document:
  1. No maintained tool covers the need.
  2. Every candidate is incompatible with the stack (Pi, Electron, embedded SQLite, offline single-user).
  3. The integration cost is clearly higher than the code it replaces, and the custom part stays small and isolated behind a port.
- **Glue, not engines.** Our code should be the domain (prompts, schemas, suggestion rules) and thin adapters between adopted tools.
- **Evaluate candidates on:** maintenance activity, licence, fit with Pi/Electron/SQLite, dependency weight, and how easily it can be swapped later.

## Architecture

Hexagonal (ports and adapters) with a feature-first layout. Read [`docs/architecture.md`](docs/architecture.md) before adding modules, ports or adapters.

## Development

Bun, electron-vite 5, TypeScript, vitest. Commands, hooks and layout: [`docs/development.md`](docs/development.md). Run `bun run check` before pushing.

## Research artifacts

- `research_notes/` and `reports/` hold research for this project. Never rewrite an earlier report; create a new one.

<!-- dharness:coverage-tiers begin — rewritten by `dharness sync`; edits here are lost. -->
Coverage targets: CORE 100%, IMPORTANT 80%, INFRASTRUCTURE 0%; classification lives
in `coverage-tiers.json`, and the wired gate enforces it. Before changing one, read
`.agents/skills/coverage-tiers/SKILL.md`, shipped by the same binary that wired this gate. dharness owns
the guide that explains the tiers; this region names no path a project lacks.
<!-- dharness:coverage-tiers end -->
