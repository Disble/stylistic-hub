# Embedded SQLite for the Stylistic backend inside an Electron hub (Windows), with Pi and no users

Research date: 2026-10-15. Local evidence is cited as file paths; web evidence as URLs. Anything not verified is marked "unverified".

## Q1. Which SQLite driver works best in Electron 44 (main process / utilityProcess) on Windows?

### Takeaway
Use built-in `node:sqlite`. Electron 44 ships Node 24.18.1+, which includes `node:sqlite` with no flag. It is synchronous, needs no native rebuild or asar unpacking, and supports extensions and online backup. The sibling Electron 44 app d-hub already uses it in a utilityProcess. `better-sqlite3` and `@libsql/client` are the fallbacks, and both carry native-module packaging costs.

### Cited Findings
- Electron 44.0.0 shipped Chromium 152, V8 15.2 and Node v24.18.1. 44.1.0 moved to Node 24.19.0 and 44.2.0 to Node 24.20.0. The latest stable is 44.4.5 (2026-09-23); its Node build was not confirmed. — [Electron 44 blog](https://electronjs.org/blog/electron-44-0); [v44.1.0](https://releases.electronjs.org/release/v44.1.0); [v44.2.0](https://releases.electronjs.org/release/v44.2.0); [Wikipedia](https://en.wikipedia.org/wiki/Electron_(software_framework))
- Status of `node:sqlite`:
  - Added in Node v22.5.0. No longer needs `--experimental-sqlite` since v23.4.0 / v22.13.0, but was still experimental then.
  - "Stability: 1.2 – Release candidate" since v25.7.0. Node 24 (and so Electron 44) is therefore on a pre-RC line where the module is unflagged but formally experimental. Inferred from the version notes.
  - Source: [Node.js sqlite docs](https://nodejs.org/api/sqlite.html)
- `node:sqlite` API:
  - Fully synchronous ("All APIs exposed by this class execute synchronously"); there is no async API.
  - Constructor options include `enableForeignKeyConstraints` (default **true**), `timeout` (busy timeout; v24.0.0 / v22.16.0), `readOnly`, `allowExtension` (default false, required for `loadExtension()`) and `defensive` (default on since v24.14.0).
  - In v26 the class is renamed `Database`, and `DatabaseSync` is deprecated (DEP0210). Electron 44 / Node 24 still uses `DatabaseSync`.
  - Source: [Node.js sqlite docs](https://nodejs.org/api/sqlite.html)
- `node:sqlite` extras:
  - `sqlite.backup(sourceDb, path, {rate, progress, source, target}) → Promise<number>` was added in v23.8.0 / v22.16.0. The source stays usable during the backup, and writes from other connections restart it.
  - `loadExtension()` was added in v23.5.0 / v22.13.0.
  - Sessions/changesets exist (`createSession`, `applyChangeset`).
  - Source: [Node.js sqlite docs](https://nodejs.org/api/sqlite.html)
- Local precedent (d-hub, Electron 44):
  - `D:\dev\disble\d-hub\dhub\package.json:36` declares `"electron": "^44.5.1"`.
  - `src/main/adapters/sqlite-storage.ts:176-178` runs `new DatabaseSync(path)`, then `PRAGMA foreign_keys = ON`, then `migrate(db)`.
  - `src/main/adapters/sqlite-migrations.ts:1,163-179` has a hand-rolled migration runner that takes a `DatabaseSync`.
  - `src/main/engine-host.ts:19` runs `utilityProcess.fork(enginePath, ['--db=…', '--pi-agent-dir=…'])`: one utilityProcess owns both the DB path and the Pi agent dir.
  - This is direct evidence that `node:sqlite` works under Electron 44 in a utilityProcess. I did not run it myself.
- Native modules have to be rebuilt for Electron's ABI. Electron uses BoringSSL, and a mismatch gives a `NODE_MODULE_VERSION` error. The recommended tool is `@electron/rebuild`. On Windows, `win_delay_load_hook` must be true, because Electron exports node symbols from `electron.exe` and there is no `node.dll`. — [Electron: using native Node modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- `better-sqlite3` packaging (secondhand):
  - `.node` files cannot load from inside asar and need `asarUnpack` (or `asar:false`).
  - A 2026 report says electron-builder 26.15.3 `install-app-deps` picked the matching N-API prebuild for better-sqlite3-multiple-ciphers 13.0.3 on Electron 44. This is a fork, not stock better-sqlite3.
  - Older better-sqlite3 versions are not N-API and need electron-rebuild.
  - Sources: [codenote 2026 post](https://codenote.net/en/posts/electron-encrypted-sqlite-libraries-prototyping-macos-windows/); [better-sqlite3 #1111](https://github.com/WiseLibs/better-sqlite3/issues/1111); [BlackGlory note](https://blackglory.me/notes/electron/Electron(v28)/Persistence/Databases/better-sqlite3(v7.4.4,_Requires_electron-rebuild)?variant=en)
- `@libsql/client` 0.17.4 is already installed in the backend, as a dependency of `@mastra/libsql`. It ships a platform-native package `@libsql/win32-x64-msvc` (seen under `stylistics-backend\node_modules\@libsql\`), so it is also a native addon that needs asar unpacking. Whether it is N-API, and so ABI-stable across Electron versions, is unverified. — local: `stylistics-backend/node_modules/@mastra/libsql/package.json:23`
- WASM options (sql.js, wa-sqlite, official sqlite-wasm/OPFS) were not researched in depth. OPFS persistence is a browser/renderer feature, which would put the DB outside the backend utilityProcess. Unverified: none of these were fetched.
- Precedent with a different runtime: "D:\Método PEN\course-platform" uses **`bun:sqlite`**, loaded through a non-literal dynamic import (`server/retrieval/index-store.ts:73-78`, `server/progress-store.ts:54-58`). Its `scripts/ai-index.ts:18` writes `<app>/data/ai-index/retrieval.sqlite`. `bun:sqlite` exists only in the Bun runtime, so it is not available in Electron and is not reusable as-is.

### Inferences
- Ranking for Windows/electron-builder packaging pain, lowest first:
  1. `node:sqlite`: zero native code, nothing to unpack, no rebuild.
  2. WASM (sql.js): pure JS, but whole-DB-in-memory and manual persistence.
  3. `better-sqlite3`: prebuilds exist, but needs rebuild/asarUnpack and breaks on Electron bumps.
  4. `@libsql/client`: native, less Electron-community precedent.
  5. `sqlite3` (node-pre-gyp, async, historically worst for Electron).
- `node:sqlite` is synchronous like better-sqlite3. Inside a dedicated utilityProcess that does not block the UI. Long queries block only that process's event loop, which is acceptable for a single-user app with small tables.
- Risk: `node:sqlite` is formally experimental on Node 24, and the API is renaming in v26 (`DatabaseSync` → `Database`). Hide it behind a thin adapter, as d-hub does.

### Gaps
- Which Node build Electron 44.4.x/44.5.x bundles, and which SQLite version Node 24's `node:sqlite` embeds (the docs page does not state it).
- Whether stock better-sqlite3 (v12.x) publishes Electron 44 prebuilds: not confirmed from its releases page.
- Whether `@libsql/client` native binding is N-API: unverified.

## Q2. Drizzle ORM support per driver, and running migrations at app start in a packaged app

### Takeaway
The installed `drizzle-orm@0.45.2` has drivers for `better-sqlite3`, `libsql`, `bun-sqlite`, `expo-sqlite` and `op-sqlite`, but **no `node-sqlite`**. Official `drizzle-orm/node-sqlite` is documented only with `drizzle-orm@rc` (1.0 line). That leaves three choices for `node:sqlite`:
- (a) upgrade to Drizzle 1.0 rc/beta,
- (b) use `drizzle-orm/sqlite-proxy` over a `DatabaseSync`, or
- (c) drop the ORM for raw SQL plus a small migration runner (the d-hub pattern).

### Cited Findings
- Drizzle docs list native SQLite drivers libsql, node:sqlite and better-sqlite3. The libsql driver has `/node`, `/web`, `/http`, `/ws` and `/wasm` variants, and the WASM one is experimental. — [Drizzle get-started SQLite](https://orm.drizzle.team/docs/get-started-sqlite)
- The `drizzle-orm/node-sqlite` page installs `drizzle-orm@rc` and `drizzle-kit@rc`. It accepts a path or `{ client: new DatabaseSync(...) }`, and offers sync `.all()/.get()/.values()/.run()`. — [Drizzle connect node-sqlite](https://orm.drizzle.team/docs/connect-node-sqlite)
- A search found no stable 0.x release adding node:sqlite, only a community `drizzle-sqlite` package referencing Drizzle PR #4346. — [search result: drizzle-sqlite](https://awesome.ecosyste.ms/projects/github.com%2Fyjl9903%2Fdrizzle-sqlite); [Drizzle 1.0.0-rc.4 notes](https://newreleases.io/project/github/drizzle-team/drizzle-orm/release/v1.0.0-rc.4)
- Local evidence:
  - `stylistics-backend/node_modules/drizzle-orm/package.json` is version 0.45.2. Its directories include `better-sqlite3/`, `bun-sqlite/`, `durable-sqlite/`, `expo-sqlite/`, `libsql/`, `op-sqlite/`, `sqlite-core/`, `sqlite-proxy/` and `migrator.*`, with no `node-sqlite/`.
  - The current config is `drizzle.config.ts`: `dialect: "postgresql"`, migrations in `./drizzle/migrations` (4 SQL files 0000–0003), migrations table `drizzle.__drizzle_migrations`.

### Inferences
- The existing PG migrations cannot be reused. A SQLite migration set needs `dialect: "sqlite"` in drizzle-kit and a fresh `0000` baseline generated from rewritten `sqlite-core` schemas.
- Running migrations at start in a packaged app (my inference; Drizzle's per-driver `migrate(db, { migrationsFolder })` reads SQL files plus `meta/_journal.json` at runtime):
  - Ship the migrations folder via electron-builder `extraResources` (or keep it unpacked).
  - Resolve it with `process.resourcesPath`.
  - Call `migrate` once in the backend utilityProcess before serving requests.
  - Option: inline the SQL as string constants, as d-hub does in `sqlite-migrations.ts`, which removes the filesystem dependency.
- For a 4-table schema, raw SQL plus a `user_version`-based runner (`PRAGMA user_version`) is a realistic, lower-risk alternative to an RC ORM. The tradeoff is that it loses the type-safe query builder that the existing repositories use.

### Gaps
- Exact drizzle-orm version that first ships `node-sqlite` and the 1.0 GA status as of Oct 2026: not confirmed.
- Whether the `sqlite-proxy` driver performs adequately as a node:sqlite shim: untested.

## Q3. Translating the schema (uuid, jsonb, CHECK, timestamps, FKs, WAL, concurrency, backups, location, corruption)

### Takeaway
Every column maps cleanly to SQLite. FK enforcement and the CHECK constraint carry over. Use WAL plus a busy timeout, with the backend utilityProcess as the only writer. Take backups with `node:sqlite` `backup()` or `VACUUM INTO`, never with a raw file copy while the WAL is live.

### Cited Findings
- Current PG schema (`src/infrastructure/persistence/schema/document.schemas.ts`):
  - It uses `uuid(...).primaryKey().defaultRandom()`, `uuid("external_document_key")`, `timestamp(..., { withTimezone: true })`, `jsonb` and `check`.
  - The FK is `.references(() => user.id, { onDelete: "cascade" })` (lines 17–48).
- `node:sqlite` turns foreign-key enforcement on by default (`enableForeignKeyConstraints: true`). d-hub also sets `PRAGMA foreign_keys = ON` explicitly. — [Node.js sqlite docs](https://nodejs.org/api/sqlite.html); local `dhub/src/main/adapters/sqlite-storage.ts:177`
- WAL mode:
  - Readers don't block writers, and only one writer is active at a time.
  - All processes must be on the same host; WAL does not work on network filesystems.
  - The `-wal` and `-shm` files are part of the DB state. Copying the `.db` without its WAL can lose commits or corrupt the copy.
  - WAL mode is persistent once set. Autocheckpoint runs at 1000 pages, and `PRAGMA wal_checkpoint(TRUNCATE)` checkpoints manually.
  - Source: [SQLite WAL](https://www.sqlite.org/wal.html)
- Online backup: `backup(sourceDb, path)` in `node:sqlite` copies while the DB stays usable. — [Node.js sqlite docs](https://nodejs.org/api/sqlite.html)

### Inferences
- Type mapping (standard SQLite practice; not individually sourced):

  | PostgreSQL | SQLite |
  |---|---|
  | `uuid` | `TEXT` (36 chars), generated in JS with `crypto.randomUUID()`; SQLite has no default UUID function |
  | `jsonb` | `TEXT` holding JSON, queried with `json_extract` if ever needed; Drizzle sqlite `text({ mode: 'json' })` |
  | `timestamptz` | `INTEGER` epoch ms (Drizzle `integer({ mode: 'timestamp_ms' })`) or ISO-8601 `TEXT`; pick one and keep it consistent |
  | `CHECK (default_genre IN (...))` and `CHECK (length(correction_instructions) <= 4000)` | portable as-is |
  | `unique(...)` | portable as-is |
- Recommended PRAGMAs at open:
  - `journal_mode=WAL` (persistent)
  - `synchronous=NORMAL`
  - `foreign_keys=ON`
  - `busy_timeout` through the `timeout` option, e.g. 5000
- Concurrency:
  - Make the backend utilityProcess the **only** process that opens the DB, and have the main process and renderer reach data over IPC/HTTP. That avoids cross-process locking entirely.
  - If the main process must read, open it `readOnly` with WAL; readers don't block the writer.
- Location:
  - Use `app.getPath('userData')/stylistic.db`, passed to the utilityProcess as an argument (the d-hub `--db=` pattern).
  - Never put it on a network or sync folder. WAL requires the same host, and OneDrive-synced folders are a known corruption risk (that last part is general knowledge, unverified here).
- Backups:
  - Periodic `backup()` or `VACUUM INTO 'snapshot.db'` into `userData/backups/`, with rotation.
  - Run `PRAGMA integrity_check` at startup, or after an unclean shutdown, to detect corruption.

### Gaps
- Whether `VACUUM INTO` and `json_*` functions are available depends on the SQLite version Node 24 bundles. Both have been in SQLite ≥3.27 / ≥3.38 for years, so this is very likely, but unverified.

## Q4. Vector search: is it needed, and how if so?

### Takeaway
Very likely **not needed**. pgvector backs only Mastra Memory semantic recall. The backend never passes `threadId`/`resourceId` (grep found no matches in `src`), so memory recall is almost certainly inert on the main path. Drop it. If it is needed later, `sqlite-vec` loads into `node:sqlite` via `allowExtension`, but it is pre-v1 alpha.

### Cited Findings
- Local: `src/mastra/constants/memory.ts` builds `new Memory({ storage: pgStore, vector: pgVector, embedder, options: { lastMessages: 10, semanticRecall: { topK: 3, messageRange: 2 } } })`. It is attached to 4 agents (`document-feedback-agent.ts:14`, `document-profile-agent.ts:14`, `editorial-agent.ts:18`, `stylistic-agent.ts:25`). `pgVector` is registered in `src/mastra/index.ts:207`.
- Local: `grep -rn "threadId|resourceId|thread:" src` returned no non-test matches.
- sqlite-vec:
  - It is "pre-v1, so expect breaking changes"; the docs page shows **v0.1.10-alpha.4**.
  - The KNN examples use brute force. There are ANN-related files (diskann, ivf), but their status is undocumented.
  - It loads in Node with `new DatabaseSync(path, { allowExtension: true }); sqliteVec.load(db)`, and also works with better-sqlite3.
  - Sources: [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec); [sqlite-vec JS docs](https://alexgarcia.xyz/sqlite-vec/js.html)
- Mastra's `LibSQLVector` provides vector search on libSQL's native vector extensions. — [Mastra libsql integration](https://mastra.ai/integrations/databases/libsql); [reference-vectors-libsql](https://cdn.jsdelivr.net/npm/@mastra/core@1.51.0/dist/docs/references/reference-vectors-libsql.md)

### Inferences
- Inference from the code: without a thread or resource, Mastra Memory does not persist or recall messages. That would make pgvector, the Ollama 768-dim embedder and `semanticRecall` dead weight. Confirm at runtime before deleting.
- If vectors come back:
  - sqlite-vec loads a platform `.dll` from `node_modules`. In Electron that file must be asar-unpacked, and `allowExtension:true` has to be set on the connection.
  - Brute-force KNN is fine for one user's few thousand chunks.

### Gaps
- Whether sqlite-vec publishes a Windows x64 npm platform package: not confirmed on the fetched pages.
- Whether Mastra Memory behaves as inferred with no thread/resource: not verified against Mastra source.

## Q5. Can workflow/orchestration state live in the same SQLite file?

### Takeaway
Yes, if Mastra stays: `@mastra/libsql` `LibSQLStore` with a `file:` URL replaces `PostgresStore` for workflow snapshots, memory and scores. It goes through `@libsql/client`, a second native driver, so it would be a separate connection, possibly to the same file. LangGraph.js has `@langchain/langgraph-checkpoint-sqlite` (`SqliteSaver`). If Pi does the orchestration, no workflow store is needed at all.

### Cited Findings
- `LibSQLStore` stores message history, workflow snapshots, traces and eval scores. The newer reference adds agents, datasets and MCP configs. `url` can be `file:` or `:memory:` locally. `init()` runs automatically when the store is passed to `Mastra`. — [Mastra memory with libsql](https://mastra.ai/docs/memory/storage/memory-with-libsql); [reference-storage-libsql (core 1.51.0)](https://cdn.jsdelivr.net/npm/@mastra/core@1.51.0/dist/docs/references/reference-storage-libsql.md)
- Local: the backend already depends on `@mastra/libsql@^1.22.2` and `@mastra/duckdb@^1.6.3` (`package.json:53,55`). `src/mastra/constants/storage.ts:2,9` already uses `DuckDBStore` for the observability domain, and DuckDB is another native addon.
- LangGraph.js `SqliteSaver` provides `fromConnString(':memory:'|path)`; the constructor takes a `Database` handle. The library behind that handle is probably better-sqlite3, but I have not verified it. — [LangChain reference SqliteSaver](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-sqlite/SqliteSaver)

### Inferences
- Sharing one file between `node:sqlite` (domain tables) and libSQL (Mastra tables) works in WAL mode on the same host. It does mean two SQLite engines writing the same file from one process, so their writes contend for the same lock (use busy timeouts).
- Simpler: give Mastra its own `mastra.db` beside `stylistic.db`, or remove Mastra storage entirely if Pi replaces orchestration.
- Removing Mastra also removes `@libsql/client` and DuckDB native modules from the Electron package. That is a large packaging win.

### Gaps
- Whether Mastra offers a `node:sqlite`-based store (avoiding libSQL native): not found.

## Q6. Compatibility with Pi: should Pi's state stay as files or move into SQLite?

### Takeaway
Pi has no database. It persists auth (`auth.json`), settings and models as files and sessions as JSONL. It exposes pluggable seams for auth (`AuthStorage.fromStorage(AuthStorageBackend)`) and settings (`SettingsManager.fromStorage`), plus in-memory variants. Sessions have only file-based or in-memory `SessionManager` factories. Recommendation: keep Pi's files in an app-owned dir beside the DB, and back up both together.

### Cited Findings (local typings, `D:\dev\disble\d-hub\dhub\node_modules\@earendil-works\pi-coding-agent`)
- `package.json:3` is `"version": "1.0.0"`; `:106-107` is `"engines": { "node": ">=22.19.0" }`. That is satisfied by Electron 44's Node 24.18+ ([Electron 44 blog](https://electronjs.org/blog/electron-44-0)).
- `dist/core/auth-storage.d.ts`:
  - Lines 1–3 describe a "CredentialStore implementation backed by auth.json".
  - `interface AuthStorageBackend { withLock(fn: (current: string|undefined) => {result, next?}); withLockAsync(...) }` (lines 11–14).
  - Backends are `FileAuthStorageBackend`, `InMemoryAuthStorageBackend` and `ReadOnlyAuthStorage`.
  - Factories: `AuthStorage.create(authPath?)`, `fromStorage(storage)`, `inMemory(data?)` (lines 44–51).
  - The backend contract is "read whole blob as string, optionally write next string under a lock", which is trivially implementable on a SQLite row.
- `dist/core/settings-manager.d.ts:194-200` has `SettingsManager.create(cwd, agentDir?)`, `fromStorage(storage: SettingsStorage)` and `inMemory(settings?)`.
- `dist/core/session-manager.d.ts`:
  - Factories `create(cwd, sessionDir?)`, `open(path, sessionDir?)`, `continueRecent`, `inMemory(cwd?, options?, entries?: FileEntry[])`, `forkFrom`, `list`, `listAll` (lines 371–414). There is no storage-backend interface; persistence is the private `persist` / `_persist(entry)` (lines 225–255).
  - The default directory is `~/.pi/agent/sessions/<encoded-cwd>/` (line 369).
- d-hub precedent: one utilityProcess receives both `--db=` and `--pi-agent-dir=` (`dhub/src/main/engine-host.ts:19`), so the SQLite DB and Pi's file state live side by side.

### Inferences
- **Auth:** you could store `auth.json` content in SQLite through a custom `AuthStorageBackend`. The benefit is small (one file); the cost is reimplementing locking semantics. Keep the file, but under `userData/pi/` rather than `~/.pi`. Consider Electron `safeStorage` for secrets; not researched.
- **Sessions:** moving them to SQLite would mean `SessionManager.inMemory(..., entries)` plus manual capture of entries. That relies on a private `_persist` and is fragile, so keep the JSONL files.
- **Consistency:** files and DB are not transactional together. Model the link as "DB row references a Pi session id/path" and tolerate dangling references (a missing session file just means no history).
- **Backups:** snapshot the DB (online backup) and copy the Pi dir in the same backup job. Exact atomicity is unnecessary for a single-user app.

### Gaps
- `ModelRegistry` / `models.json` storage seam: `model-registry.d.ts` exists, but I did not read its factories.
- Whether d-hub stores Pi auth under the app dir or `~/.pi`: not checked.

## Q7. What changes if users are removed?

### Takeaway
Drop the Better Auth tables (user, session, account, verification) and every `user_id` column/FK. `document.external_document_key` (the UUID stored in the .docx) becomes the natural unique key. `user_preferences` collapses into a single-row app-settings table.

### Cited Findings
- Local:
  - `drizzle.config.ts` includes the `./src/auth/auth-schema.ts` schema, which holds the Better Auth tables.
  - `document.schemas.ts:17-21` has `id uuid PK defaultRandom` and `user_id ... references(user.id, onDelete cascade)`, plus `external_document_key uuid notNull`.
  - The backend depends on `better-auth@^1.7.2` and `@mastra/auth-better-auth@^1.1.4` (`package.json:51,63`).

### Inferences
- Proposed SQLite schema:
  - `document(id TEXT PK, external_document_key TEXT NOT NULL UNIQUE, title, created_at, updated_at, last_used_at)`; replaces `unique(user_id, key)`.
  - `document_preferences` and `document_style_profile` keep their 1:1 FK to `document(id)` with `ON DELETE CASCADE`.
  - `app_settings` is a single row (`id INTEGER PK CHECK (id = 1)`) holding `correction_instructions` with its `CHECK (length <= 4000)`.
- One option is `external_document_key` as the PK itself. That saves a join, but a copied .docx with the same key collides. The surrogate id + unique key keeps that collision visible.
- Removing Better Auth also removes the auth middleware and its tests, and changes the add-in's auth flow. That surface is out of scope here.

### Gaps
- How the add-in authenticates to the local backend after users are removed (loopback token?): not researched.

## Q8. Is a data migration from Postgres needed?

### Takeaway
Probably not: this is a pre-production local tool, and the data is per-document preferences and profiles that can be regenerated. If needed, a one-off Node script can export from PG and import into SQLite without the user_id column.

### Cited Findings
- No evidence of production users was found in the files inspected; the workspace mentions only an MVP/local runtime (`src/mastra/index.ts:34`, "In-memory is intentional for the local/MVP runtime").

### Inferences
- If there is a migration, a script using `pg` plus `node:sqlite` would:
  - export `document`, `document_preferences`, `document_style_profile` and `user_preferences` for the single owner;
  - map timestamps to epoch ms and `jsonb` to `JSON.stringify`;
  - drop `user_id`.
- Mastra workflow snapshots and memory should not be migrated: they are transient, and the store is being replaced.
- Recommend starting fresh, plus an optional "import from server" script only if a real user has data.

### Gaps
- Actual row counts in the developer PG instance: not checked, since `.env` and the DB were off limits.

## Overall recommendation and migration plan (synthesis of the above; inferences)

### Recommended stack
- Driver: `node:sqlite` in the backend utilityProcess, as the single writer.
- File: `userData/stylistic.db`, with WAL, foreign_keys and busy timeout.
- Vectors: none. Remove Mastra Memory, pgvector and the embedder.
- Pi: its state stays as files in `userData/pi/`.
- Orchestration store: none if Pi orchestrates. If Mastra stays, use `LibSQLStore` with its own `file:` URL.
- ORM: either Drizzle 1.0 rc `drizzle-orm/node-sqlite`, or raw SQL plus a `user_version` migration runner (the d-hub precedent). Keep the adapter behind the existing repository ports, which fits the hexagonal layout.

### Plan
1. Confirm at runtime that semantic recall is unused, then remove the PG/vector/Mastra memory constants.
2. Rewrite the 3 domain schemas without users in `sqlite-core` (or as raw DDL), and generate one SQLite baseline migration.
3. Implement repository adapters on `node:sqlite` and run the existing repository tests against `:memory:`.
4. Migrate on boot in the utilityProcess: open the DB, apply PRAGMAs, migrate, run `integrity_check`, then start the server.
5. Add a backup job (online `backup()` plus a copy of the Pi dir) and rotation.
6. Remove Better Auth, `pg`, `@mastra/pg`, Docker compose PG and, if Pi replaces Mastra, `@mastra/libsql` and `@mastra/duckdb`. Fewer native addons means simpler electron-builder packaging.
7. Start fresh with data; optional one-off export script.
