# stylistic-hub — Claude Instructions

Read `AGENTS.md` in this directory first. It is the source of truth for this project, including the design principle **"do not reinvent the wheel"**: adopt an existing tool before writing our own, and justify any custom code in writing. Architecture conventions live in `docs/architecture.md`.

<!-- dharness:coverage-tiers begin — rewritten by `dharness sync`; edits here are lost. -->
Coverage targets: CORE 100%, IMPORTANT 80%, INFRASTRUCTURE 0%; classification lives
in `coverage-tiers.json`, and the wired gate enforces it. Before changing one, read
`.claude/skills/coverage-tiers/SKILL.md`, shipped by the same binary that wired this gate. dharness owns
the guide that explains the tiers; this region names no path a project lacks.
<!-- dharness:coverage-tiers end -->
