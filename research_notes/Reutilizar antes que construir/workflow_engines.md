# Workflow engines to replace Mastra workflows (adopt before build)

Scope note: research done 2026-10-15. Evidence comes from three places: the npm registry JSON, tarballs downloaded from npm and inspected (`.d.ts`, `.js`, README, CHANGELOG), and the GitHub REST API (stars and last push). Web pages were used where noted. Tarball file paths are given relative to the package root, with the npm tarball URL as the source. Anything not checked this session is marked **[UNVERIFIED]**.

The workflows to replicate (from the previous round's report, section A):
- `stylistic-workflow`: four linear `.then()` steps.
- `feedback-workflow`: two steps.

The client uses only start → runId, a poll every 1 s, and cancel. It reads only the statuses `running`, `success`, `failed` and `canceled`, and rejects `suspended`/`paused`.

The new stack is Electron 44 (Node 24) with the backend in a utilityProcess, `node:sqlite`, Pi for every LLM call, and no network services.

## Q1. Mastra workflows standalone in Electron: current API, SQLite without libSQL native, Pi in steps, weight

### Takeaway
The Mastra API the add-in uses exists today with those exact names, including a `canceled` status and a step-level `abortSignal`. Steps can call Pi directly. libSQL can be avoided: Mastra ships an `InMemoryStore`, and its `WorkflowsStorage` domain is an abstract class of about 8 methods that could be implemented on `node:sqlite`. The cost is that `@mastra/core` is 76 MB unpacked with 30 hard dependencies (AI-SDK providers, hono, posthog-node, A2A SDKs) that cannot be declared away.

### Cited Findings
- `@mastra/core` latest is 1.77.0, published 2026-10-14, Apache-2.0, `engines.node >=22.13.0`, unpackedSize 76,139,300 bytes. Its 30 runtime dependencies include `hono`, `hono-openapi`, `ws`, `execa`, `posthog-node`, `@a2a-js/sdk-v0_3`/`-v1`, `@ai-sdk/provider-v5/-v6/-v7`, `@ai-sdk/provider-utils-v6/-v7`, `chat` and `jpeg-js`. Its only peer dependency is `zod`. — [npm registry @mastra/core](https://registry.npmjs.org/@mastra/core)
- The run status union in the current source is `'running' | 'success' | 'failed' | 'tripwire' | 'suspended' | 'waiting' | 'pending' | 'canceled' | 'bailed' | 'paused' | 'skipped'`, so `canceled` exists. — `dist/**.d.ts` line 223 in the [@mastra/core 1.77.0 tarball](https://registry.npmjs.org/@mastra/core/-/core-1.77.0.tgz)
- `dist/workflows/workflow.d.ts` declares the following (same tarball):
  - On `Workflow`: `createRun(options?)` and `getWorkflowRunById(runId, { withNestedWorkflows?, fields? }): Promise<WorkflowState | null>`.
  - On `Run`: `startAsync(...)`, documented as "Starts the workflow execution without waiting for completion (fire-and-forget). Returns with the runId…".
  - On `Run`: `cancel(): Promise<void>`, documented as "This aborts any running execution and updates the workflow status to 'canceled' in storage".
  - On `Run`: a public `abortController` getter.
  — [@mastra/core 1.77.0 tarball](https://registry.npmjs.org/@mastra/core/-/core-1.77.0.tgz)
- The step execution context has `abortSignal: AbortSignal` (`dist/workflows/step.d.ts:48`). A step can pass it straight to pi-ai's `signal`. — [@mastra/core 1.77.0 tarball](https://registry.npmjs.org/@mastra/core/-/core-1.77.0.tgz)
- Storage is pluggable:
  - `dist/storage/domains/workflows/base.d.ts` declares `abstract class WorkflowsStorage extends StorageDomain`.
  - Its abstract members are `supportsConcurrentUpdates`, `updateWorkflowResults`, `updateWorkflowState`, `persistWorkflowSnapshot`, `loadWorkflowSnapshot`, `listWorkflowRuns`, `getWorkflowRunById` and `deleteWorkflowRunById`.
  - The core package also ships `WorkflowsInMemory` (`storage/domains/workflows/inmemory.d.ts`) and `InMemoryStore extends MastraCompositeStore` (`storage/mock.d.ts`).
  — [@mastra/core 1.77.0 tarball](https://registry.npmjs.org/@mastra/core/-/core-1.77.0.tgz)
- `MastraCompositeStore` routes each domain to its own adapter. — [Mastra composite storage](https://mastra.ai/reference/storage/composite)
- Workflows can be created and run without a `Mastra` instance. Snapshots, however, are "persisted using a storage instance configured on the Mastra class". — [Mastra workflows overview](https://mastra.ai/docs/workflows/overview); [Mastra snapshots](https://mastra.ai/docs/workflows/snapshots)
- `@mastra/libsql` 1.26.1 depends on `@libsql/client` 0.18.0, which depends on `libsql` 0.5.29. That package is a native addon with prebuilt optional packages for darwin x64/arm64, linux variants and **win32-x64-msvc only** (no win32-arm64). — [npm @mastra/libsql](https://registry.npmjs.org/@mastra/libsql); [npm @libsql/client](https://registry.npmjs.org/@libsql/client); [npm libsql](https://registry.npmjs.org/libsql/latest)
- A Socket.dev page for `@mastra/libsql` warns of malicious versions linked to a "Mastra AI framework compromise" supply-chain campaign, naming 1.13.1 as affected. This comes from a search-result summary and was not opened. **[UNVERIFIED in detail]** — [Socket @mastra/libsql](https://socket.dev/npm/package/@mastra/libsql/overview/1.15.0)
- The search found no reports of Mastra running inside Electron. — [search results, Socket pages only](https://socket.dev/npm/package/@mastra/libsql/overview/1.15.1)
- The repository has 28,835 stars and was last pushed 2026-10-15. GitHub reports its licence as NOASSERTION (mixed licences in the monorepo). — [GitHub API mastra-ai/mastra](https://api.github.com/repos/mastra-ai/mastra)

### Inferences
- **Exact parity is achievable.** `createWorkflow`/`createStep` → `.commit()` → `new Mastra({ workflows, storage })` → `createRun()` → `startAsync()` → `getWorkflowRunById()` → `run.cancel()` reproduces today's contract unchanged. Steps call pi-ai with `abortSignal`, so no AI-SDK model or Mastra agent is needed.
- **SQLite without native code takes two forms:**
  - (a) `InMemoryStore`. It is enough because the client never resumes after a restart, but runs are lost when the app closes.
  - (b) A home-made `WorkflowsSqliteStorage extends WorkflowsStorage` on `node:sqlite`, about 8 methods, mounted through `MastraCompositeStore`.
  - Option (b) is a custom adapter against a large internal interface that changes with Mastra's weekly releases (1.77 on 2026-10-14). That maintenance burden partly defeats "adopt".
- **Tree-shaking cannot remove the install footprint.** The hard dependencies still install, about 76 MB plus transitive ones. A bundler such as esbuild or Vite may drop unused code from the bundle, but `posthog-node`, `hono` and the others are imported by core modules. Whether they are eliminated is **[UNVERIFIED]**; it needs a bundling spike.
- **Two schema systems.** Mastra keeps zod (peer) for step schemas while Pi uses TypeBox. Mastra depends on `@standard-schema/spec`, so step schemas probably accept any Standard Schema validator **[UNVERIFIED]**.

### Gaps
- No measured bundle size after esbuild tree-shaking.
- No Electron utilityProcess test.
- Whether `getWorkflowRunById` works with `InMemoryStore` for a run started with `startAsync` was not tested. It is very likely, since the in-memory domain implements it.
- The details of the supply-chain compromise were not verified.

## Q2. Pi ecosystem: pi-durable state, and Pi packages for workflows or subagents

### Takeaway
`@earendil-works/pi-durable` **is now published on npm** (1.2.0, MIT, 2026-10-12). It does have native `node:sqlite` storage, durable tasks with checkpoints, abort cascades, and a watchable task graph. However, it calls itself "**Experimental.** The API changes without notice between releases", and 1.1.0 → 1.2.0 (five days apart) contained several breaking changes. It is shaped as a durable *agent/conversation harness*, not a step pipeline. Pi "packages" for workflows are coding-agent extensions that spawn pi sessions, so they don't fit a deterministic backend.

### Cited Findings
- On npm, `@earendil-works/pi-durable` latest is 1.2.0, published 2026-10-12 (first published 2026-09-19), MIT, `engines.node >=22.19.0`, unpacked 3.2 MB. Its dependencies are `diff`, `typebox`, `@earendil-works/chord`, `@earendil-works/pi-ai`, `@silvia-odwyer/photon` and `@earendil-works/pi-codemode`. — [npm registry](https://registry.npmjs.org/@earendil-works%2Fpi-durable)
- The README opens: "**Experimental.** The API changes without notice between releases. A durable agent harness. Conversations, model turns, tool calls, and your own state are committed to storage before anything is shown. If the process dies mid-turn, reopening the storage picks the work up where it stopped." — README.md in the [pi-durable 1.2.0 tarball](https://registry.npmjs.org/@earendil-works/pi-durable/-/pi-durable-1.2.0.tgz)
- **Storage.** The SQLite backend is `openNodeSqliteStorage(file)` from `@earendil-works/pi-durable/storage/sqlite/node` ("WAL mode with `synchronous = NORMAL`"). `dist/storage/sqlite/node.js` imports `node:sqlite`. Memory and JSONL backends also exist. "One process owns a storage at a time; there is no cross-process locking." — same tarball
- **Tasks.** A task is "a durable state machine that saves a checkpoint at every step". Tasks can own child tasks, wait on them with `allSettled`/`failFast`, and abort bottom-up. `harness.waitForTask(id)` exists, and `harness.taskGraph()`/`watchTaskGraph()` expose live task statuses `pending`, `running`, `waiting` and `completing`. — README §Concepts, §Child Tasks, §Task Graph, same tarball
- **Abort.** `conversation.abort(context)` aborts every task of the current work. Every async call takes a Chord `Context` that carries cancellation. — README §Abort and Subagents, same tarball
- **API churn.** The 1.2.0 CHANGELOG lists breaking changes:
  - `ToolTaskInput`/`ToolTaskResult` became tagged unions.
  - `content` was renamed to `output`.
  - Storage errors now fail the whole Session, and `StorageRejected` was removed.
  - 1.1.0 (2026-10-07) also had breaking `Storage` and `TaskRuntime.context()` changes.
  — CHANGELOG.md, same tarball
- `@earendil-works/pi-ai` and `pi-coding-agent` are both at 1.2.0 (2026-10-12) and require Node >=22.19.0. The monorepo `earendil-works/pi` has 115,410 stars and was pushed 2026-10-15. — [npm pi-ai](https://registry.npmjs.org/@earendil-works%2Fpi-ai); [GitHub API](https://api.github.com/repos/earendil-works/pi)
- **Pi packages.** The pi.dev registry lists workflow and subagent packages, all installed with `pi install npm:<name>`:
  - `pi-subagentura` (v3.2.0): `/workflow`, with child Pi sessions in tmux/Zellij.
  - `pi-subagent-workflow` (v0.4.0): JS scripts chaining subagents, each "run as its own pi process", with a resumable journal; requires pi 0.80.6 or later.
  - `@narumitw/pi-subagents`: chain and parallel modes.
  - `@judepayne/picode`.
  These versions come from listing summaries. **[versions UNVERIFIED on npm]** — [pi-subagentura](https://pi.dev/packages/pi-subagentura?name=tmux); [pi-subagent-workflow](https://pi.dev/packages/pi-subagent-workflow?page=25); [@narumitw/pi-subagents](https://pi.dev/packages/@narumitw/pi-subagents)
- Absurd (`absurd-sdk` 0.5.0, Apache-2.0) belongs to the same organisation (earendil-works/absurd, 2,491 stars, last push 2026-08-10). Its only peer dependency is `pg`, so it is Postgres-based. An "Absurd in SQLite" proof of concept exists, written up by Simon Willison in December 2025. — [npm absurd-sdk](https://registry.npmjs.org/absurd-sdk); [GitHub API](https://api.github.com/repos/earendil-works/absurd); [Simon Willison](https://feeds.simonwillison.net/2025/Dec/24/absurd-in-sqlite/)

### Inferences
- **pi-durable could host the workflows, at a cost:**
  - Each workflow would be a custom task kind in an extension, with phases as checkpoints. The LLM calls would go through pi-ai directly or as a conversation.
  - Its `node:sqlite` storage would own its own file, because it is single-owner.
  - This means learning Chord `Context`, the registry, documents and commits, and adapting to weekly breaking changes.
  - It gives crash-resume, which the client contract does not need.
  - Verdict: watch it; don't adopt it yet.
- **Pi workflow packages are the wrong layer.** They orchestrate interactive coding-agent sessions and processes.
- **Absurd is out.** It is Postgres-only for SDK use.

### Gaps
- No public example of a non-conversation, pure-step workflow in pi-durable was read. The README's checkout/payment example (`test/examples/24-child-tasks.ts`) is referenced but its file was not read.
- No stability roadmap for pi-durable was found.

## Q3. Other adoptable engines with SQLite and in-process execution

### Takeaway
**OpenWorkflow is the one direct fit.** Its core package (0.11.0, Apache-2.0, 356 KB) now ships a built-in SQLite backend (`openworkflow/sqlite`) that loads `node:sqlite`, with one runtime dependency. It offers in-process workers, Standard Schema inputs, a `canceled` status and `cancelWorkflowRun()`. Effect v4 is now stable as a package (`effect` 4.0.5), and its SQLite client moved to `node:sqlite`, but `effect/workflow` and `effect/cluster` are still tagged `@stability unstable`. Vercel Workflow has no SQLite world, only a partial Turso one, and needs a compiler transform. DBOS TypeScript is still Postgres-only. XState has no engine-level persistence. workflow-es has been dead since 2019.

### Cited Findings
**OpenWorkflow (`openworkflow`)**
- npm: 0.11.0, published 2026-10-12, Apache-2.0, `engines.node >=22.22.0`. Its only dependency is `cron-parser`. Peers `postgres` and `@opentelemetry/api` are both **optional** (`peerDependenciesMeta`). Unpacked size is 356 KB. Exports: `.`, `./postgres`, `./sqlite`, `./internal`. — [npm registry openworkflow](https://registry.npmjs.org/openworkflow); package.json in the [tarball](https://registry.npmjs.org/openworkflow/-/openworkflow-0.11.0.tgz)
- `dist/sqlite/sqlite.js` documents "Uses node:sqlite in Node.js or bun:sqlite in Bun" and loads `const { DatabaseSync } = require("node:sqlite")` through `createRequire`. `BackendSqlite.connect(path, { namespaceId? })` is the entry point. — same tarball
- The separate `@openworkflow/backend-sqlite` 0.6.3 is **deprecated**: "This package has moved into `openworkflow` core… Import `BackendSqlite` from `openworkflow/sqlite`." — README in the [backend-sqlite tarball](https://registry.npmjs.org/@openworkflow/backend-sqlite/-/backend-sqlite-0.6.3.tgz)
- API (`dist/client/client.d.ts`, `dist/core/*.d.ts`):
  - `new OpenWorkflow({ backend })`, `defineWorkflow(spec, fn)` (spec schema typed as `StandardSchemaV1`) and `implementWorkflow`.
  - `runWorkflow(spec, input) → WorkflowRunHandle`, whose `workflowRun.id` serves as the runId and which has `result()` and `cancel()`.
  - `cancelWorkflowRun(id)`: "Workflow runs in `pending`, `running`, or legacy `sleeping` status can be canceled".
  - `rerunWorkflowRun(id, { fromStep })`.
  - `newWorker({ concurrency, leaseDurationMs }) → Worker` with `start()`/`stop()`/`tick()`.
  - On the backend: `getWorkflowRun(...)` and `listWorkflowRuns(...)`.
  - The workflow function receives `step.run({ name, retryPolicy? }, fn)`, `step.sleep`, `step.waitForSignal` and `step.runWorkflow`.
  — [openworkflow 0.11.0 tarball](https://registry.npmjs.org/openworkflow/-/openworkflow-0.11.0.tgz)
- `WorkflowRunStatus = "pending" | "running" | "sleeping" | "succeeded" | "completed" | "failed" | "canceled"`. `WorkflowRun` carries `status`, `output`, `error` and `finishedAt`. — `dist/core/workflow-run.d.ts`, same tarball
- The worker heartbeats a lease (`extendWorkflowRunLease`) at half the lease duration. No `AbortSignal` appears in the step API, and `grep AbortController` over dist returned nothing. — `dist/worker/worker.js:280-296`, same tarball
- The docs say it "runs on Node.js 22.22+ or Bun, with PostgreSQL or SQLite storing workflow state", and that completed steps are not re-run after a crash. — [openworkflow.dev/docs](https://openworkflow.dev/docs)
- The README shows `npx @openworkflow/cli init --backend sqlite`. — README in the tarball
- The repository has 1,335 stars and was pushed 2026-10-14. — [GitHub API](https://api.github.com/repos/openworkflowdev/openworkflow)
- The dev dependencies include zod 4, valibot, arktype and yup, consistent with tests across several Standard Schema validators. — package.json in the tarball

**Effect v4**
- `effect` 4.0.5 is published (2026-10-15, MIT, zero dependencies, 51 MB unpacked), with `rc`/`beta` tags behind it. Its package exports now include `./workflow` and `./cluster` at the top level. — [npm effect](https://registry.npmjs.org/effect); package.json in the [effect 4.0.5 tarball](https://registry.npmjs.org/effect/-/effect-4.0.5.tgz)
- `dist/workflow/WorkflowEngine.d.ts` has `execute`, `poll(workflow, executionId) → Option<Result>`, `interrupt(workflow, executionId)` and `layerMemory`, several marked `@stability unstable`. `Workflow.d.ts` exposes `execute`, `poll`, `interrupt` and `resume`. — same tarball
- `dist/cluster/SingleRunner.d.ts`: "Single-process cluster layer… meant for local, embedded, or small single-node setups… still requires a SQL client because mailbox messages and replies are stored in SQL. @stability unstable @since 4.0.0". — same tarball
- `@effect/sql-sqlite-node` 4.0.5 has no dependencies (peer: `effect`). Its `dist/SqliteClient.js`: "Connects Effect SQL to SQLite on Node.js using `node:sqlite`" (`import { backup, DatabaseSync } from "node:sqlite"`). — [tarball](https://registry.npmjs.org/@effect/sql-sqlite-node/-/sql-sqlite-node-4.0.5.tgz)
- The v3-line packages `@effect/workflow` 0.19.1 and `@effect/cluster` 0.60.2 were last published 2026-07-31. — [npm @effect/workflow](https://registry.npmjs.org/@effect%2Fworkflow)
- The repository has 17,297 stars and was pushed 2026-10-15. — [GitHub API](https://api.github.com/repos/Effect-TS/effect)

**Vercel Workflow DevKit**
- `workflow` 5.2.2 (2026-10-13) depends on `@workflow/next`, `/nuxt`, `/nest`, `/rollup`, `/typescript-plugin` and others. `@workflow/world-local` 5.1.1 depends on `proper-lockfile` and `@vercel/queue`, which suggests file storage. — [npm workflow](https://registry.npmjs.org/workflow); [npm @workflow/world-local](https://registry.npmjs.org/@workflow%2Fworld-local)
- The Local World is "Not persistent… Single instance". — [Local World](https://useworkflow.dev/docs/deploying/world/local-world)
- The only SQLite-family community world is `@workflow-worlds/turso` (libSQL). One snapshot listed it as partially compatible at 28/29 E2E tests, while the Turso page dashboard showed 7/48. The figures conflict. — [Turso world](https://useworkflow.dev/worlds/turso); [Worlds ecosystem](https://useworkflow.dev/docs/worlds) (via search summary; the redirect target workflow-sdk.dev/docs/worlds returned 404)

**DBOS Transact TS**
- `@dbos-inc/dbos-sdk` 5.3.0 (2026-10-15, MIT) hard-depends on `pg`. The TS configuration takes a Postgres `systemDatabaseUrl`. — [npm](https://registry.npmjs.org/@dbos-inc%2Fdbos-sdk); [DBOS TS config](https://docs.dbos.dev/typescript/reference/configuration)

**XState v5**
- `xstate` 5.33.2 (2026-09-15, MIT, zero dependencies) has a 6.0.0-alpha.66 tag. The repository has 30,301 stars. — [npm xstate](https://registry.npmjs.org/xstate); [GitHub API](https://api.github.com/repos/statelyai/xstate)
- XState provides no storage adapter. Apps persist `getPersistedSnapshot()` themselves (prior knowledge). **[UNVERIFIED this session]**

**Others**
- `workflow-es` 2.3.5 was last published 2019-03-31 (216 stars, last push 2025-01). — [npm](https://registry.npmjs.org/workflow-es); [GitHub API](https://api.github.com/repos/danielgerlag/workflow-es)
- `liteque` 0.10.0 (2026-10-10) is a job queue. It has peer `better-sqlite3` (native) and depends on drizzle-orm. — [npm liteque](https://registry.npmjs.org/liteque)
- LangGraph.js `@langchain/langgraph` 1.5.0 has peers `@langchain/core` and `zod`. Its SQLite checkpointer uses better-sqlite3, per the previous round. — [npm](https://registry.npmjs.org/@langchain%2Flanggraph)
- `@worlds/sqlite` on JSR is a `node:sqlite` storage backend for an unrelated "Worlds" project, not a workflow engine. — [jsr @worlds/sqlite](https://jsr.io/@worlds/sqlite@0.7.0)
- Inngest, Restate and Hatchet need a server binary or Postgres, per the previous round's notes. They were not re-checked here. — [Inngest self-hosting](https://www.inngest.com/docs/self-hosting.md); [Restate](https://docs.restate.dev/get_started/quickstart)

### Inferences
- **OpenWorkflow matches every hard constraint:**
  - in-process: client and `Worker` are plain objects in one Node process;
  - `node:sqlite`, no native module, a single file;
  - offline, Apache-2.0, ESM, tiny;
  - Node >=22.22 is satisfied by Electron 44's Node 24 **[Electron's exact Node version UNVERIFIED this session]**.
- **OpenWorkflow's two semantic gaps both have small glue:**
  - (1) `cancelWorkflowRun` only flips the database status. A Pi call already in flight is not aborted, because the step API has no signal. Glue: an app-level `Map<runId, AbortController>`, created inside the workflow fn and aborted by the cancel endpoint.
  - (2) Steps retry by default, while Mastra steps did not. Glue: set `retryPolicy` to no retries on each step, or globally. The default retry values were not read **[UNVERIFIED]**.
- **Status mapping for the client:** `pending`/`running`/`sleeping` → `running`; `completed`/`succeeded` → `success`; `failed` → `failed`; `canceled` → `canceled`.
- **Latency:** dispatch goes through worker polling of the database, which adds start latency. The poll interval was not found in the `.d.ts` **[UNVERIFIED]**. `worker.tick()` exists, so the app could tick right after enqueueing.
- **Effect v4 is now a credible second engine-grade option.** It is stable as a package, uses `node:sqlite` with no native module, and has `poll`/`interrupt`. Interrupt propagates as fiber interruption, which maps onto an AbortSignal for pi-ai. But the workflow and cluster modules are still `@stability unstable`, and Effect would pervade the backend.
- **Ruled out:** Vercel Workflow (compiler transform plus a non-durable local world), DBOS TS (Postgres), Absurd (Postgres), workflow-es (unmaintained) and XState (no engine).

### Gaps
- OpenWorkflow's behaviour when a run is canceled mid-step was not tested: does the step's completion write fail, and does the worker stop? The same goes for the worker poll interval and the default retry policy.
- No Electron utilityProcess report was found for any candidate.
- OpenWorkflow's production checklist page (openworkflow.dev/docs/production) was not read.

## Q4. Ranked recommendation: is there an adoptable tool, or is custom code justified?

### Takeaway
**Yes, there is an adoptable tool: OpenWorkflow with its built-in `node:sqlite` backend.** It replaces the hand-written runner's engine part (run table, state machine, step memoisation, cancel status, lookup by id). Only glue remains: one HTTP route for each of start, poll and cancel, a status-name map, and an AbortController registry for Pi. That glue would exist with any engine. Custom runner code is therefore **not justified** as the first choice. Fall back to Mastra standalone (exact semantics, heavy), then Effect v4. Watch pi-durable until it drops "Experimental".

### Cited Findings
- (Evidence as cited in Q1 to Q3.) The differentiators:
  - OpenWorkflow is 356 KB with one dependency, `openworkflow/sqlite` loads `node:sqlite`, and it has `cancelWorkflowRun` plus a `canceled` status ([tarball](https://registry.npmjs.org/openworkflow/-/openworkflow-0.11.0.tgz)).
  - Mastra is 76 MB with 30 dependencies and has `startAsync`/`getWorkflowRunById`/`cancel` plus a step `abortSignal` ([tarball](https://registry.npmjs.org/@mastra/core/-/core-1.77.0.tgz)).
  - Effect's SingleRunner is still `@stability unstable` ([tarball](https://registry.npmjs.org/effect/-/effect-4.0.5.tgz)).
  - pi-durable calls itself "Experimental. The API changes without notice" ([tarball](https://registry.npmjs.org/@earendil-works/pi-durable/-/pi-durable-1.2.0.tgz)).

### Inferences
Ranked shortlist:

| Rank | Tool | In-process | SQLite driver | start / poll / cancel | Schema | Weight | Licence | Maintenance | Pi fit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | OpenWorkflow 0.11.0 | Yes (client plus `newWorker()`) | `node:sqlite` built in | `runWorkflow` → id / `backend.getWorkflowRun` / `cancelWorkflowRun` (status only) | Standard Schema (zod, valibot, TypeBox via adapter [UNVERIFIED]) | 356 KB, 1 dep | Apache-2.0 | Release 2026-10-12, 1.3k stars, pre-1.0 | Steps are plain async functions calling pi-ai; needs its own AbortController |
| 2 | Mastra 1.77.0 standalone | Yes (`new Mastra({workflows, storage})`, no server) | libSQL native, or `InMemoryStore`, or a custom `WorkflowsStorage` on `node:sqlite` | `startAsync` / `getWorkflowRunById` / `cancel` (aborts the step `abortSignal`) | zod (peer) | 76 MB, 30 deps | Apache-2.0 (core) | Weekly releases, 28.8k stars | Good: `abortSignal` → pi-ai `signal` |
| 3 | Effect 4.0.5 `effect/workflow` + SingleRunner + `@effect/sql-sqlite-node` | Yes | `node:sqlite` | `execute(discard)` / `poll` / `interrupt` | Effect Schema | 51 MB package (tree-shakable) | MIT | Active, 17.3k stars; modules `@stability unstable` | Agnostic; forces Effect style |
| 4 | pi-durable 1.2.0 | Yes | `node:sqlite` | `createTask` / `waitForTask` + `taskGraph` / abort | TypeBox | 3.2 MB plus Chord | MIT | Weekly breaking changes, "Experimental" | Native, but agent-harness shaped |
| — | Hand-written runner | Yes | `node:sqlite` | Built | TypeBox or zod | Smallest | — | Self | Total |
| ✗ | Vercel Workflow, DBOS TS, Absurd, Inngest/Restate/Hatchet, LangGraph, XState, workflow-es, liteque | — | — | — | — | — | — | — | Out: Postgres, server, compiler transform, wrong shape, or unmaintained |

Minimal glue for each option:
- **OpenWorkflow:**
  - Create `BackendSqlite.connect(<userData>/workflows.db)` and `new OpenWorkflow({ backend })`.
  - Use `defineWorkflow({ name: 'stylistic-workflow', schema }, async ({ input, step }) => { … step.run({ name: 'load-author-profile' }, …) … })`, keeping the four step ids as `step.run` names.
  - Call `ow.newWorker({ concurrency: 1 }).start()` at boot.
  - Add a `Map<runId, AbortController>` whose signal is passed to pi-ai.
  - Write a status mapper.
  - Expose `POST /runs`, `GET /runs/:id` and `POST /runs/:id/cancel`, where cancel = `cancelWorkflowRun` + `abort()`.
  - Disable step retries.
  - Estimated at well under 100 lines **[estimate]**.
- **Mastra:**
  - Use the existing step files with Pi calls in place of `agent.generate`.
  - Use `new Mastra({ workflows, storage: new InMemoryStore() })`, or a custom `WorkflowsStorage` (about 8 methods) on `node:sqlite` through `MastraCompositeStore`.
  - Keep the current endpoints.
  - Add a spike to measure the bundle, and an audit of supply-chain versions.
- **Effect:**
  - Write `Workflow.make` plus `Activity` per step.
  - Provide the `SingleRunner.layer` + `SqliteClient.layer({ filename })` runtime.
  - Expose HTTP handlers through `ManagedRuntime.runPromise`.
  - Translate the `poll` result into a status: `None` = still running **[semantics UNVERIFIED]**.
- **Custom code is justified only if** OpenWorkflow's spike fails. The possible failures are: `node:sqlite` inside the utilityProcess, start latency from worker polling, or cancel behaviour mid-step.

### Gaps
- None of the candidates has been spiked inside Electron 44's utilityProcess. A one-day spike of OpenWorkflow (start, poll at 1 s, cancel mid-Pi-call, restart) is the deciding test.
- OpenWorkflow is pre-1.0 (0.x); its API stability policy was not found.
- Whether TypeBox implements Standard Schema natively, or needs an adapter, was not verified.
