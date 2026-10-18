# Add-in contract

What an add-in build must give the hub, and what the hub does to it before Word sees it. `bun run addin:bundle [path]` enforces this contract (`scripts/bundle-addin.ts`, rules in `scripts/addin-bundle-contract.ts`); the default path is `../stylistic-addon`.

## What the build must provide

- A `package.json` with a `build:hub` script, or else a `build` script. The hub runs `bun run build:hub` when it exists and `bun run build` otherwise. Either may write any origin into the manifest.
- A `dist/` folder after the build, holding:
  - `manifest.xml` with the task pane page in `<DefaultSettings><SourceLocation DefaultValue="…"/>`, its origin spelled as a browser would (lower-case host, no default port), and the `<Id>` and `<Version>` every Office manifest has, which `Stylistic.docx` is made from;
  - `taskpane.html` with a `</head>`, where the hub puts the token.
- A task pane that reads the hub token from `<meta name="stylistic-hub-token">` and speaks [API v1](api.md). There is no sign-in.

A build that misses any of these fails the bundle with a message naming each missing piece, and the previous `resources/addin/` stays in place.

## What the hub does to the build

When bundling (`resources/addin/`, gitignored):

- Copies `dist/` without source maps.
- Takes the origin of the task pane `SourceLocation` and replaces it everywhere in `manifest.xml` with `https://localhost:3000`, the origin the hub serves the add-in from. A manifest that already names it is left as is.
- Writes `Stylistic.docx` next to the manifest: the document that makes Word load the sideloaded add-in.

When serving (`src/backend/adapters/http/addin-routes.ts`):

- Puts the hub token into `taskpane.html` as `<meta name="stylistic-hub-token">`.
- Adds each local file's modification time to every `src` and `href` in `taskpane.html` that names one without a query (`taskpane.js?v=…`), serves `taskpane.html` itself with `Cache-Control: no-store` and every other add-in file with `no-cache`, so Word never runs a stale copy of a rebuilt add-in and nobody has to clear Office's cache.

## Modules

The backend also serves each module named by the `STYLISTIC_MODULES` environment variable, JSON `{ "<id>": "<absolute dir>" }`, at `/m/<id>/` with the same serving steps (`src/backend/modules.ts`). The id follows the component id pattern (`^[a-z][a-z0-9-]{1,40}$`). An environment variable rather than a flag, because older servers parse their flags strictly and would exit on an unknown one. A value that is not that JSON, or a module whose `manifest.xml` has no `<Version>`, stops the backend at startup with a message naming the problem; without the variable no module is served. A module's `taskpane.html` must name its own files with relative URLs (`taskpane.js`, not `/taskpane.js`) so they resolve under `/m/<id>/`. Anything else under `/m/` is a `not_found` problem. `GET /api/v1/modules` lists the modules served ([API v1](api.md#modules)).

## Development override

The backend serves the folder its `--addin <dir>` flag names (`src/backend/entry.ts`); without the flag it serves only the API. The Electron hub passes `resources/addin/` whenever that folder exists (in an installed hub, the `addin` folder of its resources). Starting the backend yourself with `--addin <dir>` serves another build, for example the add-in's own `dist/` while working on it. That folder gets the serving steps above but not the bundling ones, so its manifest must already name `https://localhost:3000`.

## Installer staging

`bun run dist` refuses to package without `resources/addin/manifest.xml` (`scripts/require-addin.ts`). `scripts/stage-prod-addin.ts` then copies `resources/addin/` to `out/addin/`, which electron-builder packs, rewrites the manifest `<Id>` to the production add-in id so the installed hub never shares Word's sideload entry with development, stamps the shipped names from `resources/addin-shell/manifest.json`, and writes `Stylistic.docx` again for that id.
