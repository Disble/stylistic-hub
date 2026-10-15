# Orchestration alternatives to Mastra workflows for a local Electron + Pi + SQLite backend

Scope note: research done 2026-10-15 with a budget of about 16 web calls. Facts with a [Source] link were checked in this session. Anything marked "(prior knowledge, not re-verified)" comes from training data and must be checked before the team relies on it. The workflows to replicate are: `stylistic-workflow` (4 sequential typed steps) and `feedback-workflow` (2 steps), driven by the add-in through start, poll status every 1 s, and cancel.

## Q1. Can each candidate run fully in-process in Node/Electron with SQLite, and does it offer durable resume, cancellation, typed steps, observability, and an acceptable dependency weight?

### Takeaway
Only five options truly run embedded with SQLite: Mastra (via libSQL), LangGraph.js (via its SQLite checkpointer), Effect (SingleRunner plus a SQLite client), the SQLite job queues, and a hand-written pipeline. Inngest and Restate need a separate server binary. DBOS TypeScript needs Postgres. Vercel Workflow's Local World is explicitly not durable or meant for production.

### Cited Findings

**Mastra (`@mastra/core`) used standalone**
- The latest `@mastra/core` is 1.77.0, Apache-2.0. It has 30 runtime dependencies, including hono, ws, execa, posthog-node, the A2A SDKs, and `@ai-sdk/provider` v5/v6/v7. `zod` (^3.25 || ^4) is its only peer dependency. Unpacked size is about 76.1 MB, and it requires Node >=22.13.0. — [npm registry @mastra/core](https://registry.npmjs.org/@mastra/core/latest)
- Workflows can run without registration: the docs call `createRun()` on the object returned by `createWorkflow(...).commit()` before any `Mastra` instance exists. Registration adds access to "shared resources such as logging and observability features". — [Mastra workflows overview](https://mastra.ai/docs/workflows/overview)
- The run API documented today includes `createRun()`, `start()` (waits for the result), `stream()`, `restart()` (restarts an active run from its last active step), `resumeStream()`, `listActiveWorkflowRuns()` and `restartAllActiveWorkflowRuns()`. The run result statuses are `success`, `failed`, `suspended`, `tripwire` and `paused`; active runs are "running or waiting". — [Mastra workflows overview](https://mastra.ai/docs/workflows/overview)
- Snapshots are "persisted using a storage instance configured on the Mastra class", and that storage is shared by all workflows registered to the instance. — [Mastra snapshots](https://mastra.ai/docs/workflows/snapshots)
- Workflow storage is the `workflows` domain: "Durable snapshots for suspended and resumed workflow runs". With persistent storage, workflows "suspend and resume after a restart". The default in-memory store "loses data when the process exits". — [Mastra storage overview](https://mastra.ai/docs/storage/overview.md)
- The supported providers include libSQL (the local-dev default), DuckDB (offered for observability/OLAP), PostgreSQL, Cloudflare D1, Redis and others. "Adapter support varies by domain." — [Mastra storage overview](https://mastra.ai/docs/storage/overview.md); [storage reference](https://mastra.ai/reference/storage/overview)
- `@mastra/libsql` takes a `file:filename.db` URL and stores "workflow snapshots". It is installed separately from core. — [Mastra libSQL reference](https://mastra.ai/reference/storage/libsql)
- `MastraCompositeStore` can route each domain to a different adapter, for example workflows to `WorkflowsPG`. — [Mastra composite storage](https://mastra.ai/reference/storage/composite)

**LangGraph.js**
- `@langchain/langgraph-checkpoint-sqlite` is at 1.1.0, MIT. It depends on `better-sqlite3` ^12.10.0. Its peer dependencies are `@langchain/core` ^1.1.44 and `@langchain/langgraph-checkpoint` ^1.2.0. — [npm registry](https://registry.npmjs.org/@langchain/langgraph-checkpoint-sqlite/latest)
- `SqliteSaver.fromConnString(...)` uses `thread_id`-keyed put/get/list. The examples use `:memory:`; pass a file path to get persistence. — [LangChain reference SqliteSaver](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-sqlite/SqliteSaver)

**Effect (`@effect/workflow`, `@effect/cluster`)**
- `@effect/workflow` is at 0.19.1, MIT ("Durable workflows for Effect"). Its peer dependencies are `effect` ^3.22.1, `@effect/rpc`, `@effect/platform` and `@effect/experimental`. The pre-1.0 version means the API is still evolving. — [npm registry](https://registry.npmjs.org/@effect/workflow/latest)
- `SingleRunner` is "a single-process cluster layer for durable entities and workflows", intended for "local, embedded, or small single-node setups". It "still requires a SQL client because mailbox messages and replies are stored in SQL". — [Effect v4 SingleRunner](https://effect.website/docs/v4/api/effect/unstable/cluster/SingleRunner)
- `SqlMessageStorage` supports recovery after restart, redelivery, and dedup. A beta.102 note says the change works on PostgreSQL, MySQL, MSSQL and SQLite. — [Effect release notes beta.102](https://newreleases.io/project/github/Effect-TS/effect/release/@effect%2Fplatform-bun@4.0.0-beta.102); [SqlMessageStorage](https://effect.website/docs/v4/api/effect/unstable/cluster/SqlMessageStorage)
- `@effect/sql-sqlite-node` serializes access through one connection and enables WAL by default. — [Effect sql-sqlite-node SqliteClient](https://www.effect.website/docs/v4/api/sql-sqlite-node/SqliteClient)
- In v4 the cluster lives under `effect/unstable/cluster`. The v3 API page lists a `runnerStorage: "memory" | "sql"` option that the v4 page does not show. — [v3 SingleRunner](https://v3.api.effect.website/cluster/SingleRunner.ts)

**Vercel Workflow DevKit (`workflow` package, docs now at workflow-sdk.dev)**
- The Local World is the dev default. It stores data in `.workflow-data/` JSON files and processes steps synchronously. The docs list its limits: "Not scalable - Uses in-memory queuing; Not persistent - Data is stored in local files; Single instance; No authentication". — [Local World](https://useworkflow.dev/docs/deploying/world/local-world)
- The backend is chosen with `WORKFLOW_TARGET_WORLD`. The official non-Vercel world is `@workflow/world-postgres`. There are community worlds, but no SQLite world was confirmed. — [workflow-sdk.dev deploying](https://workflow-sdk.dev/docs/deploying)
- Version 5.2.0 of the `workflow` package exists on unpkg. — [unpkg workflow@5.2.0](https://app.unpkg.com/workflow@5.2.0/files/docs/worlds/vercel.mdx)

**DBOS Transact TS**
- The TS configuration names only Postgres: `systemDatabaseUrl` is "A connection string to a Postgres database in which DBOS can store internal state". There is an "Upgrading to 5.0" guide. — [DBOS TS configuration](https://docs.dbos.dev/typescript/reference/configuration)
- SQLite is supported in DBOS **Python** ("Ideal for development and testing"), and there is an alpha `Dbos.Transact.Sqlite` for C#. Neither applies to TS. — [DBOS Python databases (mintlify mirror)](https://www.mintlify.com/dbos-inc/dbos-transact-py/integrations/databases); [NuGet](https://www.nuget.org/packages/Dbos.Transact.Sqlite/)

**Inngest, Restate**
- `inngest start` is a single binary that runs a server on port 8288 with SQLite by default. The SDK finds it through `INNGEST_DEV`/`INNGEST_BASE_URL`. — [Inngest self-hosting](https://www.inngest.com/docs/self-hosting.md)
- A third-party Railway page says that without Postgres and Redis the server falls back to SQLite plus an in-memory queue that loses state on restart. It also says the server is SSPL, relicensed to Apache 2.0 after a delay. This conflicts with the official framing and is unverified. — [Railway Inngest template](https://railway.com/deploy/inngest)
- Restate is "a single self-contained binary". The Node SDK serves handlers over HTTP (port 9080), and the restate-server process must run alongside it. — [Restate quickstart](https://docs.restate.dev/get_started/quickstart); [Restate TS SDK](https://github.com/restatedev/sdk-typescript)

**SQLite-backed queues for Node**
- `liteque` is a "simple typesafe sqlite-based job queue" with Zod schemas, retries and a runner. A fork, `@zbil/liteque`, scores 48/100 on DepScope. — [npm liteque](https://npmjs.com/package/liteque); [DepScope](https://depscope.dev/pkg/npm/@zbil/liteque)
- Other options: `better-queue-sqlite` (a store for better-queue), `workmatic` (fastq plus SQLite persistence), `vardiya` (better-sqlite3 as its only dependency), `@aklinker1/job-queue` (supports better-sqlite3), and `node-persistent-queue` (serial FIFO). — [better-queue-sqlite](https://github.com/diamondio/better-queue-sqlite); [workmatic](https://scour.ing/@hello/p/https://www.npmjs.com/package/workmatic); [vardiya (DEV)](https://dev.to/zulwatha/i-got-tired-of-running-redis-for-one-background-job-so-i-built-a-sqlite-job-queue-4flk); [@aklinker1/job-queue](https://jsr.io/@aklinker1/job-queue); [node-persistent-queue](https://github.com/damoclark/node-persistent-queue?ref=pkgstats.com)
- SQLite is enough for durable single-node workflows, per the obeli.sk essay (May 2026). — [obeli.sk](https://obeli.sk/blog/sqlite-is-all-you-need-for-durable-workflows/)

### Inferences
- **Mastra standalone:** it is possible, because `createRun().start()` works without a Mastra instance. But snapshot persistence, run lookup and observability come from the Mastra instance's storage. To get polling and persistence, the team would still create `new Mastra({ workflows, storage: new LibSQLStore({ url: 'file:...' }) })`, with no agents and no server. Steps would call Pi directly; nothing forces Mastra agents. The cost is about 76 MB unpacked, AI-SDK provider packages, hono and posthog-node pulled in even when unused, plus libSQL's native client in Electron.
- **libSQL in Electron:** `@libsql/client` uses native bindings (prior knowledge, not re-verified), which adds an ABI/rebuild concern next to better-sqlite3. That means two SQLite engines in one app unless the app standardizes on one.
- **LangGraph.js:** it embeds fine with better-sqlite3, but its peer `@langchain/core` drags in the LangChain message and runnable model. Nodes can call Pi directly; LangChain models are not forced. Its state is graph state plus a per-thread checkpointer, not "run with status", so status polling would have to be built on top. That makes it heavy for a linear 4-step pipeline.
- **Effect:** technically the best embedded durable engine (SingleRunner plus SqlMessageStorage on SQLite), with typed schemas through `effect/Schema`. However, it is pre-1.0 and in v3-to-v4 flux (unstable namespace), with a steep learning curve. It also forces Effect throughout the backend and uses Effect Schema rather than TypeBox or zod.
- **Vercel Workflow:** ruled out. The only local storage is JSON files with an in-memory queue, which the vendor calls non-persistent. The durable world is Postgres. It also depends on a compiler transform for `"use workflow"` (prior knowledge, not re-verified).
- **DBOS TS:** ruled out, because it is Postgres-only in TS.
- **Inngest, Restate, Temporal, Trigger.dev, Hatchet:** all need an extra server process or binary (Temporal: a Go server; Trigger.dev and Hatchet: Postgres plus their own services, prior knowledge, not re-verified). An embedded Inngest binary is conceivable, but it means an HTTP server, SSPL licensing questions and a second process. All are ruled out for an offline single-user desktop app.
- **BullMQ (Redis), Graphile Worker (Postgres):** ruled out by the no-Redis/no-Postgres constraint (well known, not re-verified here). `p-queue` is in-memory concurrency control only (prior knowledge), so it is useful for throttling Pi calls but is not persistence.
- **SQLite queues (liteque etc.):** these give durable jobs, not multi-step workflows with per-step status. The orchestration would still be hand-written.
- **Hand-written pipeline:** typed step functions (TypeBox, already used by Pi), a `workflow_runs` table (id, workflow_id, status running|success|failed|suspended|canceled, current_step, input_json, step_outputs_json, error, timestamps), and an `AbortController` per run reproduce everything the add-in uses. Compared with Mastra, the team gives up: the built-in Studio/observability traces, generic suspend/resume and time-travel, and parallel/branch/foreach combinators. None of these appear in the two described workflows. Crash resume could be "mark running runs as failed on boot" or "restart from current_step", since the step outputs are persisted.

### Gaps
- No `WorkflowsLibSQL` domain class was confirmed by name. The libSQL page only says "workflow snapshots".
- Whether Mastra's standalone `createRun()` (without a Mastra instance) persists snapshots at all is unconfirmed. Strong signals say no, because storage comes from the Mastra instance.
- Mastra's `cancel()` and `getWorkflowRunById` were not present in the overview page fetched. The current names and the existence of a `canceled` status need checking in the run-methods reference.
- XState v5 persistence (`getPersistedSnapshot` / `createActor(..., { snapshot })`) was not verified this session. From prior knowledge: XState has no storage adapter, so the app must save the JSON snapshot itself, for example to SQLite; it is MIT and has zero dependencies.
- Latest versions and download counts were not verified for: LangGraph.js core, XState, Temporal, Trigger.dev, Hatchet, Restate, BullMQ, Graphile Worker, p-queue, better-queue, and DBOS TS (an "Upgrading to 5.0" guide suggests v5).
- Pi-ecosystem orchestration (pi-agent-core, extensions, subagents, print/RPC mode) was not researched here; another researcher owns it.

## Q2. Which options give run-status polling equivalent to Mastra's createRun/start/runById/cancel?

### Takeaway
Only Mastra has this out of the box, and only with a Mastra instance and storage. Every other embedded option needs a thin `runs` table or status API written in house. That table is also the whole cost of the hand-written approach.

### Cited Findings
- Mastra provides `createRun()`, `start()`, `stream()`, `restart()` and `listActiveWorkflowRuns()`, with statuses success/failed/suspended/tripwire/paused and running/waiting. — [Mastra workflows overview](https://mastra.ai/docs/workflows/overview)
- In LangGraph's SQLite checkpointer, state is retrieved per `thread_id` checkpoint (get/list). There is no run-status abstraction. — [SqliteSaver](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-sqlite/SqliteSaver)
- The Vercel Workflow Local World exposes runs through `npx workflow inspect runs` and a web UI, but it is not persistent. — [Local World](https://useworkflow.dev/docs/deploying/world/local-world)

### Inferences
- The add-in's contract (start, then poll a GET for status every 1 s, then cancel) is easiest to keep stable as an app-owned HTTP endpoint over a `runs` table, whatever engine runs underneath. If the backend keeps Mastra, the current endpoints survive unchanged. If it moves away, the endpoint shape can be kept identical with very little code.
- Cancellation: in a hand-written pipeline, an `AbortController` is passed to each step and into the Pi session's abort. This is likely more reliable than any engine's cancel, because the Pi session must be aborted anyway.

### Gaps
- The exact current names of Mastra's runById and cancel APIs and its `canceled` status value were not verified (see the Q1 gaps).

## Q3. What does each option force on the LLM layer, and how compatible is it with Pi?

### Takeaway
None of the shortlisted options require their own LLM abstraction for plain step functions. Mastra still installs AI SDK provider packages as hard dependencies, and LangGraph installs `@langchain/core`. Effect, the hand-written pipeline and the SQLite queues are LLM-agnostic.

### Cited Findings
- `@mastra/core` has hard runtime dependencies on `@ai-sdk/provider-v5/v6/v7` and `@ai-sdk/provider-utils-v6/v7`. — [npm registry @mastra/core](https://registry.npmjs.org/@mastra/core/latest)
- `@langchain/langgraph-checkpoint-sqlite` peer-depends on `@langchain/core` ^1.1.44. — [npm registry](https://registry.npmjs.org/@langchain/langgraph-checkpoint-sqlite/latest)
- `@effect/workflow` has no dependencies beyond the Effect platform peers. — [npm registry](https://registry.npmjs.org/@effect/workflow/latest)

### Inferences
- **Schema mismatch:** Mastra steps use zod (a peer dependency) for input/output schemas, while Pi tools use TypeBox. Keeping Mastra means maintaining two schema systems. The Mastra docs mention `@standard-schema/spec` and `json-schema` dependencies, so other Standard Schema validators may be accepted, but that is unverified. A hand-written pipeline can use TypeBox end to end.

### Gaps
- Whether Mastra workflow steps accept TypeBox through Standard Schema was not verified.

## Q4. How should the options rank for this use case?

### Takeaway
1. Hand-written typed pipeline plus a SQLite `runs` table (best fit).
2. Mastra standalone with LibSQLStore (lowest migration risk, heaviest).
3. Effect SingleRunner on SQLite (most capable embedded durable engine, highest adoption cost).
4. LangGraph.js with SqliteSaver (works, but is the wrong shape and pulls in LangChain).

Ruled out: Vercel Workflow, DBOS TS, Inngest, Restate, Temporal, Trigger.dev, Hatchet, BullMQ and Graphile Worker. SQLite job queues and p-queue are add-ons, not replacements.

### Cited Findings
- (Evidence as cited in Q1 to Q3.) The key differentiators: Mastra is about 76 MB with 30 dependencies and needs Node >=22.13 ([npm](https://registry.npmjs.org/@mastra/core/latest)). Effect's SingleRunner targets "local, embedded, or small single-node setups" ([Effect](https://effect.website/docs/v4/api/effect/unstable/cluster/SingleRunner)). Vercel's Local World is "Not persistent" ([Local World](https://useworkflow.dev/docs/deploying/world/local-world)). DBOS TS is Postgres-only ([DBOS](https://docs.dbos.dev/typescript/reference/configuration)).

### Inferences
- **1. Hand-written:**
  - The workflows are linear (4 and 2 steps), have no human-in-the-loop suspend, and are single-user.
  - Pi already supplies TypeBox and abort.
  - A `runs` table with step outputs gives both "exact replication" of the observable contract and crash diagnosis.
  - It needs about 200 to 400 lines of code (estimate).
  - It loses Mastra Studio traces; mitigate with structured logs per step.
- **2. Mastra standalone:**
  - This is the fastest path to "EXACTLY the same semantics", because the status values and snapshot format stay identical.
  - Drawbacks: the dependency weight, AI-SDK packages that go unused, a libSQL native client in addition to the app's SQLite driver, and the Node >=22.13 requirement. Check it against the Node bundled in the target Electron version.
- **3. Effect:** pick it only if the team already wants Effect elsewhere. It is pre-1.0 with v4 churn.
- **4. LangGraph:** it models graph/agent state, not run status. It brings `@langchain/core` alongside Pi with no benefit for these flows.
- **Hybrid option:** keep the Mastra step-definition style (createStep/createWorkflow) as a guide for a home-grown mini-engine. Use `p-queue` with concurrency 1 to serialize Pi calls (prior knowledge).

### Gaps
- No measured Electron bundle or install size for each option.
- No verified Electron/utilityProcess compatibility reports for `@libsql/client` or `better-sqlite3` 12.x in this session.
- Maintenance activity (commit cadence, issues) was not measured for any project.
