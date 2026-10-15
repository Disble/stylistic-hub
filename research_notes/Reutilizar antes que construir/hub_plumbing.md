# Hub plumbing: reuse-before-build inventory (Stylistic Hub, Electron 44 / Node 24, Windows per-user)

Research date: 2026-10-15. npm facts come from live `registry.npmjs.org` and `api.npmjs.org` queries made that day. Package internals come from reading the published tarballs (`npm pack`) of the exact versions named. Anything not checked live is marked UNVERIFIED.

**Component table (summary; evidence in the sections below)**

| # | Need | Best existing tool (version, licence, maintenance) | Fit / limits in production | Glue needed | Verdict |
|---|------|------|------|------|------|
| a | Localhost HTTPS cert, trusted per user | `office-addin-dev-certs` 3.0.1, MIT, published 2026-09-24. Wraps npm `mkcert` 3.2.0 (MIT, last published 2023-11-07) plus PowerShell `Import-Certificate` | Works without admin (CurrentUser Root). Paths, CA name and telemetry are dev-oriented; the default validity is 30 days | Call the lower-level `generateCertificates(paths…, days, domains)` and `installCaCertificate(path, machine=false)` with Hub paths and a longer validity. Re-check expiry at startup | ADOPT the low-level functions (or copy the ~30-line PS approach). Do not use `ensureCertificatesAreInstalled` as-is |
| b | Register / unregister the Word add-in for the current user | `office-addin-dev-settings` 4.0.1, MIT, 2026-09-24: `registerAddIn(manifestPath)` / `unregisterAddIn` write `HKCU\…\16.0\Wef\Developer` | Microsoft documents sideloading as "Not for production add-ins". It is the only no-admin, no-tenant path for personal users | A single registry value (`<manifest id>` = `<manifest path>`). Use the package or write it directly with `reg.exe` | ADOPT the mechanism knowingly (document the risk). The package drags in inquirer, adm-zip, open and an M365 toolkit peer dependency. Writing the one value directly is defensible |
| c | HTTPS server + API + static files in a utilityProcess | Hono 4.13.13 + `@hono/node-server` 2.1.5 (MIT; ~74M and ~69M downloads/week) | Built-ins: `cors`, `bearer-auth`, `secure-headers`, `ip-restriction` (+ `getConnInfo` from `@hono/node-server/conninfo`), `serve-static`, `csrf`, `body-limit`. No built-in Host allowlist | A ~10-line Host allowlist middleware, plus HTML token injection (read `index.html` once and replace a placeholder) | ADOPT Hono. Custom code only for the Host check and the token injection |
| d | SQLite + migrations on `node:sqlite` | (1) Drizzle `1.0.0-rc.4` (Apache-2.0) has `drizzle-orm/node-sqlite` + migrator, but stable `latest` 0.45.4 does NOT. (2) Kysely 0.29.6 (MIT) has `Migrator`, but its `SqliteDialect` needs a better-sqlite3-shaped driver; the `node:sqlite` adapters have about 12–31 downloads/week. (3) The dhub hand-written `user_version` runner (~20 LOC) | No mature, stable ORM/migrator targets `node:sqlite` today | — | Small schema: reuse the dhub `user_version` pattern. If an ORM is wanted, wait for Drizzle 1.0 stable |
| e | Backup / export / import | `node:sqlite` `backup()` and `VACUUM INTO` (built in) | Online, consistent snapshot | File naming, rotation, and an import that validates `user_version` before swapping | BUILT-IN. No library needed |
| f | Single instance, tray, autostart | Electron `app.requestSingleInstanceLock`, `Tray`, `app.setLoginItemSettings` | dhub already uses all three | — | BUILT-IN |
| f | Bundler | electron-vite (MIT). `latest` = 6.0.0 published 2026-10-14 (1 day old); dhub uses ^5.0.0 | — | — | ADOPT and pin 5.x until 6.0 ages |
| f | Installer + auto-update | electron-builder 26.15.3 NSIS + electron-updater 6.8.9 (MIT) with GitHub releases | Standard. Per-user NSIS needs no admin | `publish: github` config + `autoUpdater.checkForUpdatesAndNotify()` | ADOPT |
| f | Code signing | Azure Artifact Signing (formerly Trusted Signing), via electron-builder `win.azureSignOptions` | Individuals: US/Canada only. No EV certificates, so SmartScreen reputation still has to accrue | Azure subscription + identity validation | ADOPT if eligible. Otherwise ship unsigned or with an OV certificate (UNVERIFIED pricing) |
| g | Backend supervision | `utilityProcess` `spawn` / `exit` / `error` events | No built-in respawn | ~30–50 LOC: backoff restart, a `/health` poll or `parentPort` heartbeat, stdout/stderr piped to a rotating log | CUSTOM (justified) |
| — | Credential encryption | Electron `safeStorage` (DPAPI on Windows) | Main-process API only | Encrypt in main; pass plaintext to the utility process over a MessagePort | BUILT-IN |

## (a) Localhost HTTPS certificate: office-addin-dev-certs vs alternatives

### Takeaway
`office-addin-dev-certs` can be called programmatically. Its convenience entry point `ensureCertificatesAreInstalled` is hard-wired to dev defaults: `~/.office-addin-dev-certs`, a CA named "Developer CA for Microsoft Office Add-ins", 30-day validity, and Microsoft usage telemetry. A production Hub should call its lower-level `generateCertificates` and `installCaCertificate` functions with its own paths and validity, or copy the same pattern.

### Cited Findings
- The registry shows `office-addin-dev-certs` latest = 3.0.1, licence MIT, published 2026-09-24 (dist-tag `next` = 3.0.0) — [npm registry](https://registry.npmjs.org/office-addin-dev-certs). The add-in pins `^2.0.10`, one major behind — `D:\dev\eln\stylistic\stylistic-addon\package.json:84`.
- The public API (`lib/main.d.ts` in 3.0.1) re-exports `generate`, `httpsServerOptions`, `install`, `verify` and `uninstall`. Named functions include `generateCertificates`, `getHttpsServerOptions`, `ensureCertificatesAreInstalled`, `installCaCertificate`, `isCaCertificateInstalled`, `verifyCertificates` and `uninstallCaCertificate` — [tarball office-addin-dev-certs@3.0.1](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz).
- Defaults in `lib/defaults.js`:
  - certificate directory `path.join(os.homedir(), ".office-addin-dev-certs")`, with files `ca.crt`, `localhost.crt` and `localhost.key`
  - `certificateName = "Developer CA for Microsoft Office Add-ins"`
  - `daysUntilCertificateExpires = 30`
  - `domain = ["127.0.0.1","localhost"]`
  - a `usageDataObject` built with `OfficeAddinUsageData` (telemetry) and `raisePrompt: false`

  Source: [tarball 3.0.1](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz).
- `ensureCertificatesAreInstalled(days, domains, machine=false)` takes no path parameters. It verifies the default paths. If they are invalid, it uninstalls the CA, deletes the files, regenerates them at the defaults and installs the CA. It also logs to the console and reports through usage data — [tarball 3.0.1, lib/install.js:74](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz).
- `generateCertificates(caCertificatePath, localhostCertificatePath, localhostKeyPath, daysUntilCertificateExpires, domains)` accepts custom paths and validity. It uses `mkcert.createCA` and `mkcert.createCert` from the npm `mkcert` package (a JS library, not the FiloSottile Go binary) — [tarball 3.0.1, lib/generate.js:52-82](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz).
- On Windows, the install step runs `powershell -ExecutionPolicy Bypass -File install.ps1 CurrentUser <ca path>` via `execSync`. The script calls `Import-Certificate -CertStoreLocation cert:\CurrentUser\Root`, with an `X509Store("Root", …)` fallback — [tarball 3.0.1, lib/install.js:56,104; scripts/install.ps1](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz).
- Runtime dependencies are `commander`, `fs-extra`, `mkcert ^3.2.0`, `office-addin-cli` and `office-addin-usage-data` — [tarball 3.0.1 package.json](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz).
- npm `mkcert` latest = 3.2.0, MIT, last published 2023-11-07 (stale) — [npm registry](https://registry.npmjs.org/mkcert).
- Alternatives on npm:
  - `selfsigned` 5.5.0, MIT, 2026-01-12 — [npm](https://registry.npmjs.org/selfsigned)
  - `@peculiar/x509` 2.2.0, MIT, 2026-10-15 — [npm](https://registry.npmjs.org/@peculiar/x509)
  - `node-forge` 1.4.0, (BSD-3-Clause OR GPL-2.0), 2026-03-24 — [npm](https://registry.npmjs.org/node-forge)
  - `win-ca` 3.5.1, MIT, last published 2023-11-14. It reads the Windows store into Node; it does not install into it — [npm](https://registry.npmjs.org/win-ca)
- Microsoft says self-signed certificates "can be used for development and testing, so long as the certificate is trusted on the local machine" — [MS Learn: network share sideload](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins).

### Inferences
- Adding a CA to `CurrentUser\Root` makes Windows show a modal security warning ("You are about to install a certificate from a certification authority…"), which the user must accept. No admin is needed. This is standard Windows behaviour (UNVERIFIED in this session). The Hub should explain the prompt beforehand and handle a "No" answer, since `execSync` will throw.
- With a 30-day default, certificates expire monthly. The Hub must re-verify at every start and regenerate with a much longer validity, such as 825 days or more, via `generateCertificates(customPaths, days)`.
- The default CA name and folder are shared with any Yeoman dev project on the same machine. `ensureCertificatesAreInstalled` would uninstall or replace a developer's dev CA, and the developer's tooling would do the same to the Hub's. Using distinct paths and a distinct CA name avoids this, but `uninstallCaCertificate` matches the hard-coded name. So the Hub needs its own uninstall step: a one-line PowerShell `Get-ChildItem Cert:\CurrentUser\Root | ? Subject -eq … | Remove-Item`.
- Electron's `session.setCertificateVerifyProc` and `certificate-error` only affect Electron's own Chromium. Word's WebView2 task pane uses the OS trust store, so Electron cert APIs cannot replace installing into CurrentUser Root. (Inference from the architecture; not tested here.)
- Glue options:
  - (i) depend on `office-addin-dev-certs` for `generateCertificates` + `installCaCertificate` and accept the telemetry dependency and stale `mkcert`
  - (ii) use `selfsigned` (or `@peculiar/x509`) to generate a CA + leaf, plus a ~10-line PowerShell/`certutil -user -addstore Root` call

  Both are reuse. Option (ii) avoids Microsoft telemetry and the dev-tool name collision.

### Gaps
- Whether `OfficeAddinUsageData` actually sends data when there is no prior opt-in prompt (`raisePrompt: false`) was not verified.
- The exact text of the Windows root-install prompt, and whether it appears for every install, was not re-verified for Windows 11 in 2026.

## (b) Register / sideload the Word add-in for the current user

### Takeaway
`office-addin-dev-settings` exposes `registerAddIn(manifestPath)` and `unregisterAddIn`. For an XML manifest targeting Word, these write one string value under `HKCU\SOFTWARE\Microsoft\Office\16.0\Wef\Developer`. That needs no admin and works per user. Microsoft explicitly labels sideloading (and network-share catalogs) "Not for production add-ins". The supported production channels are Marketplace (AppSource) and admin-centre deployment, which need a tenant admin.

### Cited Findings
- `office-addin-dev-settings` latest = 4.0.1, MIT, 2026-09-24 — [npm registry](https://registry.npmjs.org/office-addin-dev-settings).
- Exports include `registerAddIn(manifestPath, registration)`, `unregisterAddIn`, `unregisterAllAddIns`, `getRegisteredAddIns`, `enableDebugging`, `enableLiveReload` and `setWebView` — [tarball 4.0.1, lib/dev-settings.js:6-33,221-262](https://registry.npmjs.org/office-addin-dev-settings/-/office-addin-dev-settings-4.0.1.tgz).
- The Windows implementation uses `DeveloperSettingsRegistryKey = HKEY_CURRENT_USER\SOFTWARE\Microsoft\Office\16.0\Wef\Developer` (`lib/dev-settings-windows.js:47`). For XML manifests whose hosts exclude Outlook, `registerAddIn` ends with `registry.addStringValue(key, manifest.id, manifestPath)` (lines 190-192). JSON (unified) manifests and Outlook go through a "service" path instead (lines 173-188) — [tarball 4.0.1](https://registry.npmjs.org/office-addin-dev-settings/-/office-addin-dev-settings-4.0.1.tgz).
- Runtime dependencies include `adm-zip`, `inquirer`, `open`, `winreg 1.2.4`, `office-addin-manifest`, `office-addin-usage-data`, plus a peer dependency `@microsoft/m365agentstoolkit-cli ^1.1.11` — [tarball 4.0.1 package.json](https://registry.npmjs.org/office-addin-dev-settings/-/office-addin-dev-settings-4.0.1.tgz).
- Microsoft's deployment table lists Sideloading: "As part of your development process, to test your add-in… (Not for production add-ins.)". Microsoft Marketplace is "to distribute your add-in publicly to users". The integrated apps portal is for "users in your organization" — [MS Learn: Deploy and publish](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish).
- On network share: "Deployment by network share isn't supported for production add-ins". It is Windows-only and does not support the unified manifest. Trust is configured via `HKCU\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{GUID}` with `Id`, `Url` and `Flags=1`. Removal is "by clearing the Office cache" — [MS Learn: network share](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins).
- The Marketplace route "gives you the option of including installation of your add-in with the installation of your Windows app" — [MS Learn: Deploy and publish](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish).
- Centralized Deployment and the integrated apps portal are admin-centre features for an organization — [MS Learn: Deploy and publish](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish).

### Inferences
- For a personal user with no M365 admin, the only zero-friction options are developer sideloading (`Wef\Developer`) and a TrustedCatalogs entry pointing at a local folder. Both are documented as non-production and could change without notice. The production-grade alternative is a Marketplace listing whose manifest points at `https://localhost:3000`. Marketplace certification requires the add-in to work across platforms, which a localhost backend may conflict with (policy 1120.3 referenced on the same page).
- If dev sideloading is adopted, writing the single registry value directly (`reg add "HKCU\…\Wef\Developer" /v <id> /d <path>` or a small `winreg` call) is less code and fewer dependencies than pulling in `office-addin-dev-settings`. Its interactive and M365 dependencies have no use in an end-user app. This is "reuse the mechanism, not the CLI package".
- Keep the manifest as XML (add-in only manifest). The unified JSON manifest takes the service path and is unsupported for network shares.

### Gaps
- No Microsoft statement was found on whether `Wef\Developer` registrations persist through Office updates or trigger any user-visible "developer add-in" banner in 2026.
- How Word behaves when the manifest file is removed while still registered, and whether Office caches the manifest (`%LOCALAPPDATA%\Microsoft\Office\16.0\Wef`), was not verified.

## (c) HTTPS server in a utilityProcess: Hono vs Fastify vs node:https, plus security middleware

### Takeaway
Hono plus `@hono/node-server` covers almost every guard out of the box:
- `cors` (exact origin)
- `bearer-auth`
- `secure-headers`
- `ip-restriction` with `getConnInfo` (loopback peer check)
- `serve-static`, `body-limit` and `csrf`

The only missing piece is a Host-header allowlist for DNS-rebinding protection, which is about 10 lines of custom middleware. Injecting the per-install token into the HTML is likewise a small custom transform.

### Cited Findings
- `hono` latest = 4.13.13 (MIT, published 2026-10-04; `next` = 5.0.0-rc.1), with ~74.0M downloads/week. `@hono/node-server` latest = 2.1.5 (MIT, 2026-10-13; `latest-1` = 1.19.17), with ~69.5M/week — [npm registry hono](https://registry.npmjs.org/hono), [npm @hono/node-server](https://registry.npmjs.org/@hono/node-server), [npm downloads API](https://api.npmjs.org/downloads/point/last-week/hono).
- Hono 4.13.13 subpath exports include `./bearer-auth`, `./cors`, `./csrf`, `./secure-headers`, `./ip-restriction`, `./conninfo`, `./body-limit`, `./serve-static`, `./html`, `./logger`, `./request-id` and `./timeout` — [tarball hono@4.13.13 package.json](https://registry.npmjs.org/hono/-/hono-4.13.13.tgz).
- `@hono/node-server` 2.1.5 exports `./conninfo` (`getConnInfo`), `./serve-static` and `./early-hints` — [tarball @hono/node-server@2.1.5](https://registry.npmjs.org/@hono/node-server/-/node-server-2.1.5.tgz).
- `ipRestriction` takes the runtime's `getConnInfo` helper plus `{ allowList, denyList }`, supporting IPv4, IPv6, CIDR and `*` — [Hono docs: IP Restriction](https://hono.dev/docs/middleware/builtin/ip-restriction). That docs page only shows Bun and Deno examples, not Node.
- Fastify latest = 5.12.7 (MIT, 2026-10-13), ~15.4M/week; `@fastify/cors` 11.3.1 (MIT, 2026-10-08) — [npm fastify](https://registry.npmjs.org/fastify), [npm @fastify/cors](https://registry.npmjs.org/@fastify/cors).
- No Hono built-in for Host-header validation was found. The MCP TypeScript SDK's Hono/Express packages ship `hostHeaderValidation(allowedHostnames)` (a port-agnostic Host allowlist answering 403) and auto-enable DNS-rebinding protection on 127.0.0.1 binds. That SDK is v2 beta — [MCP TS SDK v2 Hono](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/hono/hono.html), [MCP TS SDK hostHeaderValidation](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/middleware/hostHeaderValidation.html).
- `host-validation` (brannondorsey) is an Express middleware for DNS-rebinding protection — [ecosyste.ms entry](https://awesome.ecosyste.ms/projects/github.com%2Fbrannondorsey%2Fhost-validation). Its maintenance status was not checked.

### Inferences
- Pulling in the MCP SDK or an Express-only package just for a Host check is a worse trade than ~10 lines: `if (!['localhost:3000','127.0.0.1:3000'].includes(c.req.header('host'))) return c.text('',403)`. This is custom code justified by the absence of a fitting tool.
- `@hono/node-server` `serve({ fetch, createServer: https.createServer, serverOptions: { key, cert }, hostname: '127.0.0.1', port: 3000 })` covers TLS and the bind address. This usage pattern is UNVERIFIED for 2.x; check the README.
- Token injection: serve `index.html` through a route that reads the built file once and replaces a placeholder such as `<meta name="hub-token" content="__TOKEN__">`. Use `serve-static` for everything else. No templating library is needed.
- Fastify would also work, but needs `@fastify/cors`, `@fastify/static` and `@fastify/bearer-auth` as separate plugins. Hono's single package with zero dependencies is a better fit for a utilityProcess bundle.

### Gaps
- Whether `@hono/node-server` 2.x changed the `serve()` HTTPS options API relative to 1.x was not verified (2.1.5 is two days old).
- Whether Word's WebView2 sends a stable `Origin` (`https://localhost:3000`) for same-origin fetches from the task pane was not verified. If it does not, exact-Origin enforcement must allow a missing Origin on same-origin GETs.

## (d) SQLite migrations on node:sqlite

### Takeaway
As of 2026-10-15 no stable, mature ORM/migrator targets `node:sqlite`:
- Drizzle's `node-sqlite` driver and migrator exist only in `1.0.0-rc.4` / `beta.22`; stable `latest` is 0.45.4, without it.
- Kysely's built-in `SqliteDialect` expects a better-sqlite3-shaped driver, and the `node:sqlite` adapters are tiny community packages.

The sibling app's ~20-line `PRAGMA user_version` runner is the lowest-risk choice. Drizzle 1.0 is the upgrade path once it goes stable.

### Cited Findings
- `drizzle-orm` dist-tags: `latest` 0.45.4 (2026-10-08), `rc` 1.0.0-rc.4 (published 2026-06-27; rc.1 2026-04-30), `beta` 1.0.0-beta.22. Licence Apache-2.0. `drizzle-kit`: `latest` 0.31.11, `rc` 1.0.0-rc.4 — [npm drizzle-orm](https://registry.npmjs.org/drizzle-orm), [npm drizzle-kit](https://registry.npmjs.org/drizzle-kit).
- `drizzle-orm@1.0.0-rc.4` contains `node-sqlite/` (`driver`, `session`, `migrator`, which exports `migrate`). `drizzle-orm@0.45.4` has no `node-sqlite` directory, only `better-sqlite3`, `bun-sqlite`, `durable-sqlite`, `expo-sqlite`, `op-sqlite`, `sqlite-core` and `sqlite-proxy` — [tarball 1.0.0-rc.4](https://registry.npmjs.org/drizzle-orm/-/drizzle-orm-1.0.0-rc.4.tgz), [tarball 0.45.4](https://registry.npmjs.org/drizzle-orm/-/drizzle-orm-0.45.4.tgz).
- `kysely` latest = 0.29.6 (MIT, 2026-09-16; `next` 0.30.0-beta.2), ~20.8M/week. It includes `dist/migration/migrator` and `file-migration-provider` — [npm kysely](https://registry.npmjs.org/kysely), [tarball 0.29.6](https://registry.npmjs.org/kysely/-/kysely-0.29.6.tgz).
- Kysely's `SqliteDatabase` / `SqliteStatement` interface requires `readonly reader: boolean`, plus `all(parameters: ReadonlyArray)`, `run(parameters)` and `iterate(parameters)` taking array parameters. `node:sqlite` `StatementSync` does not have that shape natively, so an adapter is required — [tarball kysely 0.29.6, dist/dialect/sqlite/sqlite-dialect-config.d.ts:30-42](https://registry.npmjs.org/kysely/-/kysely-0.29.6.tgz).
- Community adapters:
  - `@fileshed/kysely-node-sqlite` 0.1.0, MIT, 2026-08-02, ~31 downloads/week
  - `kysely-node-sqlite` 1.1.0, MIT, 2025-07-20, ~12/week ("Kysely SQLite adapter for the built in node:sqlite module", spooky-finn)
  - MikroORM ships a `NodeSqliteDialect` for Kysely
  - `@bureaudouble/kysely-sqlite-node` on JSR is 0.0.1-alpha

  Sources: [npm @fileshed](https://registry.npmjs.org/@fileshed/kysely-node-sqlite), [npm kysely-node-sqlite](https://registry.npmjs.org/kysely-node-sqlite), [MikroORM NodeSqliteDialect](https://mikro-orm.io/api/sql/class/NodeSqliteDialect), [JSR bureaudouble](https://jsr.io/@bureaudouble/kysely-sqlite-node).
- `umzug` latest = 3.8.3, MIT, last published 2026-05-01. It is storage-agnostic, so it needs a custom storage adapter for `node:sqlite` — [npm umzug](https://registry.npmjs.org/umzug).
- The sibling dhub writes its own runner: an append-only `MIGRATIONS: string[]` where `user_version` = the number of applied migrations. `applyMigrations` loops from `PRAGMA user_version` and sets `PRAGMA user_version = version + 1` per step — `D:\dev\disble\d-hub\dhub\src\main\adapters\sqlite-migrations.ts:3-4,163-170,179`.

### Inferences
- Drizzle 1.0 rc has been in rc since April 2026 and rc.4 dates from June. Shipping production on an rc ORM conflicts with "adopt mature tools". Re-check whether `latest` has moved to 1.x before deciding.
- Kysely plus a 31-downloads/week adapter is also not mature. Writing the ~25-line adapter yourself is possible (map `reader` from `stmt.columns().length > 0`, spread the parameters), but that is custom code anyway.
- Verdict: reuse the dhub `user_version` pattern, preferably extracted and shared rather than rewritten. Wrap each migration in `BEGIN`/`COMMIT`. Plain SQL with typed hand-written repositories suffices for a small local schema.

### Gaps
- Drizzle's official 1.0 GA date was not found. Whether the `node-sqlite` migrator works from an asar-packed `migrationsFolder` in Electron was not verified.

## (e) Backups and export/import

### Takeaway
Use built-ins: the `node:sqlite` `backup()` function and/or `VACUUM INTO 'path'`. No library is needed. Export/import is application glue: copy the file, then validate `PRAGMA user_version` and `PRAGMA integrity_check` before swapping.

### Cited Findings
- Node's `node:sqlite` module documents `sqlite.backup(sourceDb, path[, options])` for an online backup — [Node.js sqlite docs](https://nodejs.org/api/sqlite.html). The exact added-in version and the options (`rate`, `progress`, `source`/`target` database names) were not re-fetched in this session (UNVERIFIED).
- The dhub sibling has no backup implementation (no `backup(` match under `src/main`) — local grep of `D:\dev\disble\d-hub\dhub\src\main`.

### Inferences
- `VACUUM INTO` gives a compact, defragmented copy in one statement. `backup()` is incremental and non-blocking for a live DB. Either is enough; choose `backup()` while the backend is serving.
- Importing should run in the backend process while the API is quiesced. Validate the incoming file in a temporary `DatabaseSync`, run migrations on it, then rename-swap.

### Gaps
- Whether `backup()` is still flagged experimental (via `node:sqlite` stability) in the Node 24 build shipped with Electron 44 was not verified.

## (f) Electron app infrastructure

### Takeaway
All of it is off the shelf:
- electron-vite (bundling)
- electron-builder NSIS + electron-updater on GitHub releases (packaging and updates)
- `app.requestSingleInstanceLock`, `Tray` and `app.setLoginItemSettings` (single instance, tray, autostart)

dhub already uses most of these. Code signing: Azure Artifact Signing (renamed from Trusted Signing) accepts individual developers only in the US and Canada, issues no EV certificates, and SmartScreen reputation still accrues over time.

### Cited Findings
- `electron-builder` latest = 26.15.3 (MIT; `v26` tag 26.17.0, `next` 27.0.0-alpha.10). `electron-updater` latest = 6.8.9 (MIT; `next` 7.0.0-alpha.9) — [npm electron-builder](https://registry.npmjs.org/electron-builder), [npm electron-updater](https://registry.npmjs.org/electron-updater).
- `electron-vite` latest = 6.0.0, published 2026-10-14 (MIT); dhub pins `^5.0.0` — [npm electron-vite](https://registry.npmjs.org/electron-vite); `D:\dev\disble\d-hub\dhub\package.json` (devDependencies).
- dhub reuse evidence:
  - `app.requestSingleInstanceLock()` at `D:\dev\disble\d-hub\dhub\src\main\app.ts:173`
  - `new Tray(...)` at `src\main\tray.ts:26`
  - `app.setLoginItemSettings({...})` at `src\main\adapters\electron-login-item.ts:19`
  - NSIS target with `oneClick: false`, `allowToChangeInstallationDirectory: true` and a custom `include: build/installer.nsh` in `D:\dev\disble\d-hub\dhub\electron-builder.yml`
  - No `electron-updater`/`autoUpdater` and no `safeStorage` usage in `src\main` (local grep)
- electron-builder 26.15.3 `win.azureSignOptions` (`WindowsAzureSigningConfiguration`) takes `publisherName`, `endpoint`, `certificateProfileName` and `codeSigningAccountName`. The type comments say the alternative signing config "Cannot be used in conjunction with `azureSignOptions`" — [tarball app-builder-lib@26.15.3, out/options/winOptions.d.ts:25-143](https://registry.npmjs.org/app-builder-lib/-/app-builder-lib-26.15.3.tgz).
- Artifact Signing: "Public Trust certificates are available to organizations in the United States, Canada, the European Union, the United Kingdom, Australia, New Zealand, Japan, South Korea, Singapore, Switzerland, Norway, and Israel. Individual developers must be located in the United States or Canada." Individual validation requires an Azure billing account of type Individual and a government ID via Microsoft Authenticator Verified ID (AU10TIX) — [MS Learn: Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
- Artifact Signing needs a paid Azure subscription (no free, trial or sponsored). It has Basic and Premium SKUs, is billed at the full SKU amount and not pro-rated, and issues no EV certificates "and no plan to" — [MS Learn: Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq), [pricing page](https://azure.microsoft.com/pricing/details/artifact-signing/).
- "SmartScreen reputation builds up automatically. The prompt stops appearing once the file hash has sufficient download history." — [MS Learn: Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq), linking [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
- Docs for `app.requestSingleInstanceLock`, `app.setLoginItemSettings` and `safeStorage` are at [Electron app API](https://www.electronjs.org/docs/latest/api/app) and [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). They were not re-fetched this session; the behaviour is established, so the specifics are UNVERIFIED for Electron 44.

### Inferences
- An individual developer outside the US/Canada cannot use Artifact Signing Public Trust. Their alternatives are an OV certificate from a commercial CA (cloud HSM or token, since CA/B rules require hardware key storage) or shipping unsigned and accepting the SmartScreen warnings. Price and availability were UNVERIFIED.
- Because the hash-based reputation resets per build, frequent auto-updates delay SmartScreen clearance. Batch releases.
- Per-user NSIS (`perMachine: false`, the default) installs to `%LOCALAPPDATA%\Programs`, needs no admin, and suits electron-updater (inference from electron-builder defaults; UNVERIFIED).
- Pin electron-vite to 5.x until 6.0.0 is at least two weeks old (published 2026-10-14).

### Gaps
- The electron-builder Windows signing docs URL (`/code-signing-win.html`) returned 404, so the options came from the typings instead. Current SmartScreen behaviour for Artifact Signing (non-EV) certificates in 2026 has only Microsoft's general statement.

## (g) Supervising the utilityProcess backend; credential encryption

### Takeaway
Electron gives events but no supervisor: `utilityProcess` emits `spawn`, `exit` (with code) and an experimental `error` (FatalError), and offers no auto-restart. A small custom supervisor (restart with backoff, health check, log piping) is justified, because no maintained library targets `utilityProcess`. For secrets, Electron `safeStorage` (DPAPI on Windows) is the off-the-shelf choice.

### Cited Findings
- `utilityProcess.fork(modulePath, args, options)` options:
  - `env`, `execArgv`, `cwd`
  - `stdio` (only stdout/stderr configurable; stdin must be `ignore`)
  - `serviceName` (shown in metrics and `child-process-gone`)
  - `respondToAuthRequestsFromMainProcess`

  Its events are `spawn`, `error` (experimental, `FatalError`, followed by `exit`), `exit` (code) and `message`. The page "describes no built-in restart behavior" — [Electron utilityProcess docs](https://www.electronjs.org/docs/latest/api/utility-process).
- dhub forks once with `utilityProcess.fork(enginePath, [--db=…, --pi-agent-dir=…], { serviceName: 'dhub-engine' })`. On `exit` it only closes the RPC channel (`rpc.close(...)`); there is no restart — `D:\dev\disble\d-hub\dhub\src\main\engine-host.ts:1,19,21`.
- `safeStorage` encrypts and decrypts strings using OS facilities (DPAPI on Windows) and is available from the main process — [Electron safeStorage docs](https://www.electronjs.org/docs/latest/api/safe-storage) (not re-fetched; UNVERIFIED for Electron 44 specifics).

### Inferences
- The supervisor is about 30–50 LOC:
  - fork with `stdio: 'pipe'`
  - pipe stdout/stderr to a rotating file (a small rotating writer, or an existing logger such as `electron-log`, UNVERIFIED version)
  - on `exit` with a non-zero code, restart with exponential backoff and a crash-loop cap
  - health via `parentPort` heartbeat or `GET /health` over the loopback HTTPS
  - also listen to `app.on('child-process-gone')`
- Generic supervisors such as PM2 or forever target `child_process`/daemons and do not fit `utilityProcess`. Custom code is justified here.
- `safeStorage` lives in main, so decrypt there and send secrets to the backend over the `MessagePort`/`parentPort`, never through argv or env (which are visible to other processes of the same user).

### Gaps
- Whether `utilityProcess` can load modules from inside `app.asar` (needed for the Hono bundle and migrations) is not stated on the docs page. dhub's working packaged build suggests it works for bundled JS (inference).
- No library specifically supervising Electron `utilityProcess` was found (search not exhaustive).
