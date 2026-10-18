# Product foundation

Objective: prepare the hub for the next phase, an official product: everything on `main`, Git Flow with `dev`, a release skill for local installers, architecture and roadmap docs, and a local installer of the latest version. Branches: `main` ← `dev` ← `feature/product-foundation`. Delivery: `ask-on-risk`. Test runner: vitest (`bun run check`), gates `dharness check`.

## Specs

- **S1** — "Necesitamos unir todo a main." Every branch's work lands on `main`. The remote repository is the user's job ("Vamos a crear un repo, de eso ya me encargo"): nothing is pushed.
- **S2** — "Vas a sacar de main una rama dev. Y la rama dev será nuestra rama de desarrollo. Vamos a usar Git Flow Workflow con rama dev como rama de desarrollo principal y main para despliegues." Branch `dev` from `main`; the workflow is written down (feature, release and hotfix branches, what merges where) where agents and people read it, and the release configuration agrees with it.
- **S3** — "Vamos a necesitar un skill para releases, pero cuando sea el momento de hacer releases, en todo caso ahorita el skill de releases va a ser para generar eh, instaladores en local." The `release` skill's current mode builds a Windows installer locally (no remote needed); the semantic-release path stays documented for when the remote exists.
- **S4** — "Adicionalmente necesitamos ir documentando lo que sería la arquitectura, un poquito de siguientes milestones y features importantes que necesitamos." Architecture documented for the product (the whole system: Electron hub, backend, add-in, Word loading, packaging) and a roadmap with the next milestones and important features, grounded in what exists and the known open points.
- **S5** — "También quiero que me generes un instalador en local para tener la última versión aquí en el computador." A Windows installer built from the latest `main`/`dev` on this machine.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S2 (branches) | inline (parent owns git) | pending | |
| T2 | S2 (docs, config), S3 | delegated writer (parallel with T3; user asked for delegation) | pending | |
| T3 | S4 | delegated writer (parallel with T2) | pending | |
| T4 | S5 | background build (per-action) | pending | |

## Log

- **L1** (2026-10-17, user): "Una vez hayas terminado eso, vamos a avanzar para irnos preparando a la siguiente fase, que ya sería un producto oficial. Lo primero, lo primero. Necesitamos unir todo a main. Vamos a crear un repo, de eso ya me encargo. Pero ahorita enfócate en unir todo a main. Vas a sacar de main una rama dev. Y la rama dev será nuestra rama de desarrollo. Vamos a usar Git Flow Workflow con rama dev como rama de desarrollo principal y main para despliegues. Vamos a necesitar un skill para releases, pero cuando sea el momento de hacer releases, en todo caso ahorita el skill de releases va a ser para generar eh, instaladores en local. Adicionalmente necesitamos ir documentando lo que sería la arquitectura, un poquito de siguientes milestones y features importantes que necesitamos. También quiero que me generes un instalador en local para tener la última versión aquí en el computador."
- **L2** (2026-10-17): every local branch (`feat/mvp`, `feat/mvp-ui`, `feat/release`, `feat/hub-api-v1`) is contained in `feat/hub-api-v1` (e04a6c3), and `main` (5b5cf36) is its ancestor: `main` fast-forwards. The `release` skill today drives semantic-release, which needs an `origin` remote.
