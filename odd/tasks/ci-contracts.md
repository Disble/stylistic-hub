# M2 — CI and contracts

Objective: roadmap M2 (docs/roadmap.md). Branch `feature/ci-contracts` from `dev`. Delivery: single PR-sized slice merged `--no-ff` into `dev`. Runner: `bun run check` locally (dharness local only), GitHub Actions remotely.

## Specs

- **S1** GitHub Actions in each repo running `check`, build on every push and pull request; dharness is never run in CI (L2: "no lo uses en CI y ya. Solo para local y tienes que seguir el coverage tiers").
- **S2** The API v1 OpenAPI document diffed against the last `server-v*` release; "a pull request that removes a field from an API v1 response fails CI".
- **S3** Module contract run in the add-in's own CI: "an add-in build missing `manifest.xml` or `</head>` fails the add-in's CI" — owned by the add-in team (coordinated, L3).
- **S4** "one `release:server` and one `release:hub` published from the remote".

## Tasks

| ID | Specs | Route | Status | Evidence |
|---|---|---|---|---|
| T1 | S1 | inline | done | `c4ae033`; CI run (L5) |
| T2 | S2 | inline | done | `c4ae033`; local probe L4; remote probe L6 |
| T3 | S3 | add-in session | pending on add-in push | add-in local `c904ad9` (L3) |
| T4 | S4 | inline | partial | release jobs in `c4ae033`; first runs on merge to `dev` (L7) |

## Log

- **L1** (2026-10-18) User: "desde ahora tendrás que continuar con el resto por tu cuenta porque no estaré disponible. … cuidado con la sobreingeniería y sobredimensionalización … las decisiones delicadas se las toma midiendo, y probando hipótesis falsables … Tu reporte final será en un artifact después de haber terminado con todo el ODD."
- **L2** (2026-10-17) User on dharness: "no se planteó eso para que funcione en CI, así que no lo uses en CI y ya. Solo para local y tienes que seguir el coverage tiers." CI sets `LEFTHOOK=0` (the lefthook config extends the dharness gate) and runs `format:check`, `lint`, `typecheck`, `test:coverage` (coverage tiers) and `check:word` through `bun run check`.
- **L3** Add-in session (stylistic-addon-39) did S3 locally: `c904ad9` on `feat/hub-analysis-adapter` adds `build:hub` and a CI with the contract step; 543/543 tests pass locally. Its push fails ("Permission denied (publickey)") and merging to its `main` needs its user; I did not push for it. Corrections accepted: bun, not npm; `feat/hub-adapter` is superseded and will not be merged.
- **L4** Hypothesis H1: "the v1 document can be generated without a server for both HEAD and `server-v0.0.1`, and oasdiff flags a removed response field." Probe: `scripts/openapi-doc.ts` on HEAD and on `git archive server-v0.0.1 src` extracted under `node_modules/.cache` (so imports resolve against current node_modules): both 200, 8 paths. oasdiff 1.33.0: unchanged → "No changes detected", exit 0; `dropped` removed from `Chunk` → `response-required-property-removed`, exit 1. H1 holds. Tool adopted (oasdiff), not written. A worktree with a copied `node_modules` was tried first and was too slow (> 5 min); discarded.
- **L4a** Decisions kept small: no v2 exemption logic (a v2 lives at another path, so the v1 diff is all that matters); pack (installer) runs only in the hub release job, because `dist` needs the add-in bundle; the hub release job checks the add-in's `main` for `build:hub` and skips with a notice until it exists, so it starts by itself once the add-in lands. `@semantic-release/github` pinned explicitly (it was only transitive) so releases appear as GitHub Releases, which M3 needs for assets.
