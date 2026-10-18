# Add-in packaging contract

Objective: the hub packages any add-in checkout through a written contract it enforces itself, instead of depending on one add-in branch's script name and on Word's cache. Branch: `feat/hub-api-v1`. Delivery: `ask-on-risk`. Test runner: vitest (`bun run check`), gates `dharness check`.

## Specs

- **S1** — The user's question: "¿cómo funciona el empaquetado de todas estas cosas? Por ejemplo, si mañana creo un addon nuevo, ¿cómo lo vas a empaquetar?" The hub must be able to bundle an add-in checkout that has no `build:hub` script: `bun run addin:bundle [path]` builds it and the bundled `manifest.xml` points Word at the hub's origin (`https://localhost:3000`) whatever origin the add-in's own production build wrote (today `https://www.contoso.com/`). A checkout that has `build:hub` keeps working.
- **S2** — The bundle step checks the contract and fails with a message that names what is missing, before replacing `resources/addin/`: a `dist/manifest.xml`, a `dist/taskpane.html` with a `</head>`, and a task pane source location in the manifest. A failed bundle leaves the previous `resources/addin/` in place.
- **S3** — The contract is written down for whoever builds an add-in: what the hub needs from the build, what the hub does to it (manifest origin, token meta tag, versioned asset URLs, `Cache-Control`), and how the installer stages it (`stage-prod-addin.ts`). Linked from `docs/architecture.md`, with the custom-code table updated.
- **S4** — "Pues no, no funciona." (user, with a screenshot of the task pane still showing "Backend no disponible. Verifica que el servidor Mastra esté ejecutándose."). A rebuilt add-in must reach Word without the user clearing any cache. Done in `bef61c1`.

## Tasks

| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S4 | inline | done | `bef61c1` |
| T2 | S1, S2, S3 | delegated (context backstop; user asked for delegation) | done (uncommitted) | RED/GREEN in L5 |
| T3 | S1–S4 | independent verifier (Risk item 5: build and packaging scripts) | pending | |

## Log

- **L1** (2026-10-17, user): "Pues no, no funciona. Pregunta, ¿cómo funciona el empaquetado de todas estas cosas? Por ejemplo, si mañana creo un addon nuevo, ¿cómo lo vas a empaquetar?"
- **L2** (2026-10-17, user): "Sí te das cuenta lo que me estás pidiendo, ¿verdad? Sí te das cuenta?" — asking the user to clear Office's cache by hand and to approve obvious fixes was wrong; the hub must handle it.
- **L3** (2026-10-17): cause of the screenshot: `resources/addin/` held a 2026-10-15 build with the Mastra adapter; after rebuilding it from stylistic-addon `feat/hub-analysis-adapter` (88a3102, via `build:dev` because that branch lacks `build:hub`, which lives only in `feat/hub-adapter` 5cd3a98), Word kept running its cached `taskpane.js`. `bef61c1` versions the task pane's asset URLs by file mtime and serves add-in files with `Cache-Control: no-cache`; verified on the restarted dev hub (`taskpane.js?v=…`, `no-cache`, `/api/v1/status` ready). 315 tests pass.
- **L4** (2026-10-17, user): "yo te recomiendo que vayas haciendo esto con ODDs y delegaciones, ¿eh? Porque esto puede que se alargue bastante. Continua"
- **L5** (2026-10-17): T2. `scripts/addin-bundle-contract.ts` picks `build:hub` or `build`, checks `dist/` (manifest, task pane `SourceLocation`, `taskpane.html` with `</head>`), rewrites the task pane origin to `https://localhost:3000` and stages next to `resources/addin/`, swapping only at the end; `bundle-addin.ts` uses it. vitest `include` gained `scripts/**/*.test.ts`; `.dharness/fallow.jsonc` gained a `scripts` zone (allows no app zone), since fallow flagged the changed scripts as outside every zone. RED: 15/15 failing against a stub; GREEN: 15/15. Real `bun run addin:bundle` on stylistic-addon `feat/hub-analysis-adapter` ran `build` (contoso) and the bundled manifest has 10 `localhost:3000`, 0 `contoso`. Probe with an empty `build`: fails naming `dist/manifest.xml` and `dist/taskpane.html` missing; `resources/addin/manifest.xml` hash unchanged. Contract written in `docs/addin-contract.md`, linked from `docs/architecture.md` with a custom-code row. Open: `docs/development.md` still says the bundle uses `build:hub` (outside T2's edit surface).
