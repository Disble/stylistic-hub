# Pi as the orchestration base for Stylistic workflows (pi-ai / pi-coding-agent / dhub engine precedent)

Scope note: evidence comes from the installed packages at `D:\Método PEN\course-platform\node_modules\@earendil-works\*` (v1.0.2, all eight packages share the version) and `D:\dev\disble\d-hub\dhub\node_modules\@earendil-works\*` (v1.0.0), from the GitHub repo page, and from the dhub source. Local sources are cited as file paths with line numbers. Date of research: 2026-10-15. "PEN" below means `D:\Método PEN\course-platform\node_modules\@earendil-works`.

## 1. Does pi-ai have structured output / JSON-schema responses?

### Takeaway
pi-ai has no `responseFormat`/`structuredOutput`/`complete(schema)` API. What it does have is TypeBox-typed tools, provider-side strict constrained sampling for tool arguments (`constrainedSampling: { type: 'json_schema', strict: 'prefer' | 'require' }`), per-provider `toolChoice` options that can force a tool call, and `validateToolCall()`. So the pattern is: one "submit result" tool with a TypeBox schema, force it, validate it, retry if invalid. The app has to build that wrapper.

### Cited Findings
- The provider-neutral `ToolChoice` type is only `"auto" | "none"`. It cannot force a call — [PEN/pi-ai/dist/types.d.ts:23](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/types.d.ts); `SimpleStreamOptions.toolChoice?: ToolChoice` (types.d.ts:244-246).
- Provider-specific option types do allow forcing:
  - Anthropic: `toolChoice?: "auto" | "any" | "none" | { type: "tool"; name: string }` — [PEN/pi-ai/dist/api/anthropic-messages.d.ts:58-61](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.d.ts)
  - Google Generative AI and Vertex: `"auto" | "none" | "any"` — api/google-generative-ai.d.ts:4, api/google-vertex.d.ts:4
  - OpenAI completions: the SDK's `ChatCompletionToolChoiceOption` — api/openai-completions.d.ts:6
  - Codex: `"auto"|"none"|"required"` — api/openai-codex-responses.d.ts:8
  - Mistral: `"required"` or a named tool — api/mistral-conversations.d.ts:7
  - Bedrock: `"any"` or a named tool — api/bedrock-converse-stream.d.ts:6
- The README describes constrained sampling for tools. `strict: 'prefer'` uses provider-side strict schema enforcement when the provider supports it and otherwise falls back to normal tool calling. `strict: 'require'` makes the request fail when the provider can't honor it. Strict mode is supported for OpenAI, Anthropic, supported Bedrock models, Mistral, and Gemini 3 (Google `VALIDATED` mode). Earlier Gemini versions fall back under 'prefer' and reject 'require' — [PEN/pi-ai/README.md:541-557](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- Tools are defined with TypeBox schemas. `Type`, `Static` and `TSchema` are re-exported from pi-ai. For Google compatibility, use the `StringEnum` helper instead of `Type.Enum`, because Type.Enum generates anyOf/const patterns that Google doesn't support — README.md:105, 509-539
- `toolcall_end` delivers a complete tool call that is **not** schema-validated. Validation is a separate step through `validateToolCall(tools, toolCall)`, which throws on invalid args. The README pattern returns the validation error as a tool result so the model can retry — README.md:667-700, 720; dist/utils/validation.d.ts:9
- Grammar-constrained custom tools (OpenAI Lark/regex) exist for GPT-5+ models only — README.md:557-573.

### Inferences
- Recommended replacement for Mastra `structuredOutput(zod)`:
  1. Define `submit_suggestions` (correct-text) and `submit_profile_update` / `submit_feedback_decision` tools. Give each a TypeBox schema with `additionalProperties: false`, use `StringEnum` for `category` (6 values), `severity` (high|medium|low), `type` (track-change|comment-only) and `status` (updated|ignored), and set `constrainedSampling: { type:'json_schema', strict:'prefer' }`.
  2. Force the call per provider: Anthropic `{type:'tool', name}`, Google `'any'` with a single tool, OpenAI `{type:'function', function:{name}}` or `'required'`.
  3. On the returned `toolCall`, run `validateToolCall`. Optionally re-validate with zod if the app wants to keep its existing zod schemas as the source of truth.
  4. On a validation failure, append the error as a `toolResult` and call again, at most N times. If there are no tool calls at all, fall back to a "JSON in text" parse.
- The provider-neutral `toolChoice` can't force, so this wrapper has to branch on `model.api` (via `hasApi()`) to pick the right forcing value. This is a small adapter the app owns.
- Large outputs (a whole `profileMarkdown`) inside a tool argument are fine for schema purposes. Streaming partial JSON is available if a progress UI is wanted (README.md:623-665).

### Gaps
- I did not verify whether strict mode accepts every schema feature the suggestions array needs (for example optional `suggestedText` combined with `additionalProperties:false` under OpenAI strict, which requires every property to be in `required`). This needs a spike per provider.
- No evidence was found of a built-in "JSON mode" or `response_format` passthrough. `onPayload` could inject one (see Q3), but that is unverified.

## 2. Can models be called directly via pi-ai (no agent session)? Trade-offs vs `createAgentSession` headless

### Takeaway
Yes. `createModels()` / `builtinModels()` gives a `Models` collection with `stream`, `complete`, `streamSimple` and `completeSimple`. These are single-shot calls with auth resolution, usage and cost included. For deterministic workflow steps this is a better fit than `createAgentSession`, which brings settings files, resource discovery (AGENTS.md, skills, extensions), a system prompt, compaction and coding tools.

### Cited Findings
- Quick start: `models.stream(model, context)` and `models.complete(model, context)`, with `finalMessage.usage.input/output` and `usage.cost.total` — [PEN/pi-ai/README.md:107-224](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- The `Models` collection routes each request to the provider that owns the model. Provider factories can be registered individually (e.g. `anthropicProvider()`), or all at once with `builtinModels()`, which the README calls "the heavy, explicit entrypoint" — README.md:237-271
- API implementations can also be called directly (`stream(claudeModel, normalizeContext(context), {...})`), with an option type per API id (AnthropicOptions, GoogleOptions, OpenAICompletionsOptions, ...) — README.md:1351-1378
- pi-agent-core's `Agent` wraps `models.streamSimple` and adds tool execution and an event stream — [PEN/pi-agent-core/README.md:1-40](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-agent-core/README.md)
- `createAgentSession()` by default creates a `ModelRuntime`, a file-backed `SettingsManager`, a persistent `SessionManager`, a `DefaultResourceLoader` and the default tools. Each of these can be overridden (`noTools`, `customTools`, `SessionManager.inMemory()`, `SettingsManager.inMemory()`) — [PEN/pi-coding-agent/docs/sdk.md:96-106, 36-50](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
- Session `prompt()` resolves after the run, "including automatic retries". `agent_settled` signals that nothing else will continue automatically — sdk.md:62-94.
- The dhub precedent uses `createAgentSession` for headless steps. It is in-memory, has an explicit tool list and a `SettingsManager.inMemory({})`, and only the final assistant text is consumed — `D:\dev\disble\d-hub\dhub\src\main\adapters\pi-session.ts:198-202, 266`; `src/main/adapters/pi-headless.ts:84-116`; `src/main/domain/headless.ts` (`failureOf` returns "The model returned no text" when there is no text).

### Inferences
- Pros of direct pi-ai for Stylistic:
  - No agent loop. There are no tools to execute other than the forced output tool.
  - No system-prompt contamination from AGENTS.md or skills.
  - Full typed provider options (thinking, toolChoice).
  - `usage.cost` is returned per call.
  - Minimal dependencies (pi-ai alone, plus TypeBox).
- Cons of direct pi-ai:
  - The app re-implements retry policy. pi-ai exports `retryAssistantCall`, so this is small.
  - The app wires auth/credential storage itself. The coding-agent's `ModelRuntime` already reads `auth.json` and `models.json`. A hybrid that uses `ModelRuntime` only for auth and model resolution is possible: dhub calls `modelRuntime.getAvailable()` (pi-headless.ts:72).
  - No session transcript persistence. The workflow layer stores its own run records.
- `createAgentSession` headless makes sense only if a step needs tools (for example a future "look up RAE/Fundéu" tool). None of the five LLM passes listed need tools.

### Gaps
- I did not check whether `ModelRuntime` exposes `complete()`/`stream()` directly. The changelog mentions `generateImages()` and `classify()` on ModelRuntime (PEN/pi-coding-agent/CHANGELOG.md:184-185), which suggests it does, but this is unverified for chat completion.

## 3. Per-call options: temperature, thinking, provider-specific (Google safety), max tokens, abort, retries, cost

### Takeaway
Temperature, maxTokens, signal, timeoutMs, maxRetries, maxRetryDelayMs, headers, sessionId/cacheRetention, `onPayload` and thinking (unified `reasoning` level, or per-API `thinking: { enabled, budgetTokens, level }` for Google) are all first-class. Google **safety settings are not modelled anywhere** in pi-ai. The only route is the `onPayload` hook, which can inspect or replace the provider payload before it is sent. Usage and cost come back on every `AssistantMessage`, including failed ones.

### Cited Findings
- `ProviderRequestOptions` fields:
  - `signal`, `apiKey`, `fetch`, `env`, `headers`
  - `onPayload(payload, model)`: "inspecting or replacing provider payloads before sending"
  - `onResponse`
  - `timeoutMs`: OpenAI/Anthropic SDK clients default to 10 minutes
  - `maxRetries`: SDK clients default to 2
  - `maxRetryDelayMs`: default 60000
  - Source: [PEN/pi-ai/dist/types.d.ts:58-112](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/types.d.ts)
- `StreamOptions` adds `temperature`, `samplingParams` (OpenAI-compatible adapters only), `maxTokens`, `transport`, `cacheRetention` (default "short"), `sessionId` and `metadata` — types.d.ts:113-160.
- Unified reasoning: `completeSimple(model, ctx, { reasoning: 'minimal'|'low'|'medium'|'high'|'xhigh'|'max' })`. It is silently ignored on non-reasoning models — README.md:982-1017.
- `GoogleOptions` is `{ toolChoice?, thinking?: { enabled, budgetTokens?, level?: GoogleApiThinkingLevel } }` and nothing else (no safety field) — [PEN/pi-ai/dist/api/google-generative-ai.d.ts:1-10](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.d.ts). A grep for `safetySettings|HARM_CATEGORY|BLOCK_NONE` across pi-ai/dist returned no matches (local grep, 2026-10-15).
- Abort: an aborted request ends with `stopReason: 'aborted'`. A partial message can be continued afterwards — README.md:1117-1175.
- Error model: request failures after the stream is returned never throw. The final message carries `stopReason: 'error'`, `errorMessage`, partial content, and partial `usage` with cost — README.md:1091-1115.
- `stopReason: "length"` signals truncation at maxTokens — README.md:1078-1088.
- `retryAssistantCall(produce, policy {enabled, maxRetries, baseDelayMs, maxAgentDelayMs}, signal, callbacks)`:
  - retries only transient errors (`isRetryableAssistantError`)
  - fails fast on quota/billing exhaustion
  - never retries an abort
  - Source: [PEN/pi-ai/dist/utils/retry.d.ts:1-47](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/utils/retry.d.ts)
- Coding-agent retry defaults are `retry.maxRetries` 3, `baseDelayMs` 2000, `maxAgentDelayMs` 60000 and `retry.provider.maxRetries` 0. The docs advise keeping provider retries at 0 so Pi can handle quota errors itself — [PEN/pi-coding-agent/docs/settings.md:125-133](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/docs/settings.md)
- `transformHeaders` is a Models-only option on all four call methods — README.md:404-426.

### Inferences
- Mastra `temperature: 0` maps to `temperature: 0`. Note that some reasoning models reject or ignore temperature; this is provider behaviour, not verified in Pi.
- Google "thinking level HIGH" maps to `thinking: { enabled: true, level: <GoogleApiThinkingLevel> }` via `hasApi(model,'google-generative-ai')`, or to the unified `reasoning: 'high'`.
- Google `safetySettings: BLOCK_NONE` for the literary genre has to be added in the app with `onPayload: (p) => ({ ...p, config: { ...p.config, safetySettings: [...] } })`. The exact payload shape the Google adapter builds is **unverified**: it likely follows the `@google/genai` `generateContent` params, where `safetySettings` sits under `config`. This needs a spike that logs the payload.
- Mastra `maxRetries: 3` maps to `retryAssistantCall({enabled:true,maxRetries:3,baseDelayMs:2000})` around each step, with provider `maxRetries: 0`.

### Gaps
- I did not see the values of `GoogleApiThinkingLevel` (api/google-shared.d.ts was not read).
- No Pi feature corresponds to Mastra scorers (LLM judges). They would be ordinary extra LLM calls in the app.

## 4. Model fallback across providers

### Takeaway
There is no client-side cross-provider fallback pool in pi-ai or pi-coding-agent. The only "fallback" constructs are Anthropic's server-side refusal-fallback field (`allowedFallbackModels`) and OpenRouter's `allow_fallbacks`. Mastra-style model pools with ordered fallback must be built at the app level.

### Cited Findings
- `AnthropicAllowedFallbackModel { provider, model, cost }` is used for "server-side refusal fallback". Callers must omit `fallbacks` when it is empty — [PEN/pi-ai/dist/types.d.ts:239-243, 771-776](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/types.d.ts); `allow_fallbacks?: boolean` (OpenRouter routing) at types.d.ts:796.
- A grep for "fallback" in pi-coding-agent/docs/*.md found only unrelated uses: compaction overrides, terminal and theme fallbacks — local grep, PEN/pi-coding-agent/docs.
- pi-ai advertises "hand-off to other models mid-session": the same `Context` can be sent to a different model — [PEN/pi-ai/README.md:3](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- `isRetryableAssistantError` classifies transient errors versus deterministic ones (quota/billing) — retry.d.ts:39-50.

### Inferences
- An app-level `runWithPool(pool: ModelRef[], call)` would: try model i with `retryAssistantCall`; on a non-retryable or exhausted error (or a refusal or validation failure), move to model i+1, reusing the same `Context` (messages are provider-neutral); and record which model answered plus the accumulated cost.
- Because the context is portable across providers, the pool can mix subscription OAuth models and API-key models.

### Gaps
- I did not verify how a Gemini `SAFETY` finish reason is surfaced (likely `stopReason:'error'` with a message). This matters for deciding when to fall back.

## 5. Providers catalogue and auth methods

### Takeaway
1.0.x ships around 35 built-in providers. Supported routes:
- OAuth subscriptions: Anthropic (Claude Pro/Max), OpenAI "Sign in with ChatGPT", OpenAI Codex (legacy), GitHub Copilot, OpenRouter.
- API keys: from environment variables, `auth.json`, or `!command`.
- Ambient cloud credentials: Bedrock, Vertex ADC.
- Any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, llama.cpp) via `models.json` or `createProvider`.

**Google Gemini CLI and Google Antigravity OAuth were removed** in an earlier release, so a Google subscription login is no longer available. Google is reachable only through `GEMINI_API_KEY` or Vertex.

### Cited Findings
- Supported provider list: OpenAI, Azure OpenAI, OpenAI Codex (legacy, ChatGPT Plus/Pro OAuth), Anthropic, Google, Vertex AI, Mistral, Groq, Cerebras, xAI, OpenRouter, Vercel AI Gateway, DeepSeek, GitHub Copilot (OAuth), Amazon Bedrock, Fireworks, Together, Hugging Face, Moonshot/Kimi, MiniMax, Qwen, Xiaomi, and "Any OpenAI-compatible API: Ollama, vLLM, LM Studio" — [PEN/pi-ai/README.md:61-97](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md); `KnownProvider` union at types.d.ts:21.
- OAuth providers: Anthropic (Claude Pro/Max), OpenAI (Sign in with ChatGPT), OpenAI Codex (legacy), GitHub Copilot, OpenRouter. Login runs `models.login(id,'oauth',{prompt,notify})` with auth_url and device_code events. Refresh is automatic and runs under a credential-store lock — README.md:1728-1772.
- CLI login: `npx @earendil-works/pi-ai login` saves `auth.json` in the current directory — README.md:1796-1806.
- Changelog entries: "Removed built-in Google Gemini CLI and Google Antigravity support. Existing configurations using those providers must switch to another supported provider." and "Removed Google Gemini CLI and Google Antigravity built-in login, default model, documentation, and example extension support." — [PEN/pi-coding-agent/CHANGELOG.md:2044, 2094](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md). The pi-ai/dist/providers directory contains only `google` and `google-vertex` Google providers (local ls).
- Credential precedence is runtime `--api-key`, then the stored `auth.json` credential, then `apiKey` from `models.json`, then env vars or ambient cloud credentials — [PEN/pi-coding-agent/docs/models.md:23](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/docs/models.md)
- Local models: Ollama, LM Studio, vLLM and SGLang are configured in `models.json` with a dummy `apiKey`. `$ENV` and `!command` interpolation are supported — models.md:37-64. For such servers set `compat.supportsDeveloperRole:false` and `supportsReasoningEffort:false` — pi-ai README.md:1321.
- Programmatic custom provider: `createProvider({ id:'ollama', ..., auth:{apiKey:{resolve: async()=>({auth:{}})}}, models:[...] })` — pi-ai README.md:1209-1245.
- Vertex supports `GOOGLE_CLOUD_API_KEY` or ADC — README.md:1774-1794.

### Inferences
- For Stylistic users, the realistic subscription routes are Claude Pro/Max OAuth, ChatGPT sign-in, and Copilot. The current Gemini-specific settings (thinking HIGH, safety BLOCK_NONE) imply a Gemini API key or Vertex, not a subscription.
- Using subscription OAuth tokens in a third-party app may be constrained by provider ToS. This is not verified here and should be flagged to the product owner.

### Gaps
- The exact release that removed Gemini CLI/Antigravity is not identified; the changelog line numbers place it well before 0.82.

## 6. Orchestration features: workflows, subagents, extensions, RPC

### Takeaway
pi-ai, pi-agent-core and pi-coding-agent provide no workflow DSL or step graph. Orchestration primitives are:
- the `Agent` loop (pi-agent-core)
- `AgentSession` with steer/follow-up, abort, events, extensions and MCP (pi-coding-agent)
- print/JSON/RPC subprocess modes

The monorepo now also has an **experimental `@earendil-works/pi-durable`** package. It is a durable task harness (checkpointed task state machines, child tasks with allSettled/failFast, `resume()`, SQLite storage) and is the closest thing to a workflow engine in Pi. It is explicitly unstable.

### Cited Findings
- The repo `earendil-works/pi` lists chord, pi-telemetry, pi-ai, **pi-durable**, pi-agent-core, pi-coding-agent and pi-tui. The licence is MIT — [GitHub earendil-works/pi](https://github.com/earendil-works/pi)
- pi-durable README (via GitHub):
  - work runs as durable tasks, each a state machine that checkpoints every step
  - a task can own child tasks and wait under `allSettled` or `failFast`
  - `resume()` continues unfinished runs after a crash
  - an idempotent `requestId` prevents double submission
  - tools marked `replay:"safe"` are re-run
  - storage options: `MemoryStorage`, `openNodeSqliteStorage(file)` (WAL), JSONL, Durable Object SQLite
  - `conversation.abort(context)` stops work
  - `harness.taskGraph()`/`watch()` expose live state for UIs
  - the README labels it **experimental**: "The API changes without notice between releases"
  - Source: [GitHub packages/durable](https://github.com/earendil-works/pi/tree/main/packages/durable)
- pi-durable is not present in either local node_modules install (local ls of both @earendil-works directories).
- pi-agent-core Agent: `new Agent({ initialState:{systemPrompt, model}, streamFn: models.streamSimple.bind(models) })`, with subscribe, prompt, steering and follow-up — [PEN/pi-agent-core/README.md:11-40, 385](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-agent-core/README.md)
- AgentSession: `steer()`, `followUp()`, `abort()`, `waitForIdle()`, events, inline extensions via `DefaultResourceLoader`, and MCP and codemode as opt-in extensions in the SDK — [PEN/pi-coding-agent/docs/sdk.md:62-118](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md)
- CLI integration offers print, JSON and RPC modes for subprocess use — sdk.md:3-5, 147; docs/rpc.md (193 lines, not read in full).
- pi-mcp is "a small, standalone Model Context Protocol client" with no dependency on the MCP SDK or other pi packages — [PEN/pi-mcp/README.md:1-5](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-mcp/README.md)
- The changelog refers to a v4 lane-based `Session`/`SessionRepo` with durable operation records in pi-agent-core, and an `AgentHarness` v2 scaffold where "unfinished operation paths reject with HarnessNotImplemented" — PEN/pi-coding-agent/CHANGELOG.md:775-808.

### Inferences
- For five linear LLM passes with an optional branch, a hand-written TypeScript step runner (like dhub's `executeAutomation`) is simpler and more stable than pi-durable. pi-durable is worth watching for crash-resume, but adopting an "API changes without notice" package for a single-user tool is a risk.
- Neither RPC mode nor extensions add anything for these workflows.

### Gaps
- pi-durable's npm version, and whether it is published at all, were not checked.
- docs/rpc.md and the subagent support mentioned for pi-durable were not read in detail.

## 7. Storage: what Pi persists and the pluggable hooks

### Takeaway
pi-coding-agent persists everything under `<agent-dir>` (`PI_CODING_AGENT_DIR` or the SDK `agentDir`): settings.json, auth.json, models.json, mcp.json, extensions, skills, prompts and themes. Sessions are JSONL. Every store has an in-memory or injectable variant:
- `AuthStorage.create/fromStorage/inMemory`
- `SettingsManager.create/fromStorage/inMemory`
- `SessionManager.create/open/inMemory`
- `ModelRuntime.create({authPath, modelsPath})`

pi-ai itself only takes injected `CredentialStore` and `ModelsStore` (both default to in-memory).

### Cited Findings
- Agent directory contents: settings.json, keybindings.json, mcp.json, models.json, auth.json, AGENTS/CLAUDE.md, SYSTEM.md, APPEND_SYSTEM.md, extensions/, skills/, prompts/, themes/. Its location is set by `PI_CODING_AGENT_DIR` or the SDK `agentDir` — [PEN/pi-coding-agent/docs/configuration.md:7-24](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/docs/configuration.md)
- `AuthStorage` exposes `static create(authPath?)`, `static fromStorage(storage: AuthStorageBackend)` and `static inMemory(data?)` — PEN/pi-coding-agent/dist/core/auth-storage.d.ts:49-51.
- `SettingsManager` exposes `create(cwd, agentDir?)`, `fromStorage(storage)` and `inMemory(settings?)` — dist/core/settings-manager.d.ts:194-200.
- `SessionManager` exposes `create(cwd, sessionDir?)`, `open(path, ...)` and `inMemory(cwd?, options?, entries?)` — dist/core/session-manager.d.ts:371-386.
- `ModelRuntime.create(options?)` (model-runtime.d.ts:56). An SDK example uses `ModelRuntime.create({ authPath, modelsPath })` and `setRuntimeApiKey` — PEN/pi-coding-agent/examples/sdk/09-api-keys-and-oauth.ts:18-29.
- The pi-ai `CredentialStore` contract is `read`, `list`, `modify` (a serialized read-modify-write; OAuth refresh runs inside it so concurrent processes can't double-refresh) and `delete`. A stored credential owns its provider, and a failed refresh never falls back to an env key — PEN/pi-ai/README.md:428-453. `ModelsStore` persists dynamic catalogs — README.md:1295.
- Session JSONL format: docs/session-format.md (not read in detail). `SettingsManager` setters queue disk writes, so call `flush()` when the write must be durable — CHANGELOG.md:3319.
- The precedent dhub points `PI_CODING_AGENT_DIR` to its own directory, so runs never touch the user's `~/.pi` — `D:\dev\disble\d-hub\dhub\src\main\engine\entry.ts` (piAgentDir block) and `src/main/engine-host.ts:14-18`.

### Inferences
- Stylistic should set its own agent directory (for example `%APPDATA%/stylistic/pi`) or inject a SQLite-backed `CredentialStore`/`AuthStorageBackend`, so its secrets are isolated from a user's Pi CLI.
- With direct pi-ai calls, no session JSONL is produced. Run history goes into the app's SQLite only.

### Gaps
- The `AuthStorageBackend` interface shape was not read. It is also unverified whether `ModelRuntime.create` accepts an `AuthStorage` instance (only `authPath`/`modelsPath` were seen).

## 8. Licence, release cadence, version pinning

### Takeaway
MIT throughout. Release cadence is very fast: about 20 releases between 0.82.0 (2026-07-24) and 1.0.2 (2026-10-04), with breaking changes in several minors. 1.0.1 stopped shipping npm-shrinkwrap. Pin exact versions, keep all `@earendil-works/*` packages on the same version, and upgrade deliberately.

### Cited Findings
- Every package's package.json has `"license": "MIT"` (local, both installs). The repo licence is MIT — [GitHub](https://github.com/earendil-works/pi)
- Changelog headings: 1.0.2 (2026-10-04), 1.0.1 (2026-10-03), 1.0.0 (2026-10-01), 0.99.2 (09-30), 0.99.1/0.99.0 (09-29), 0.87.1 (09-22), 0.87.0 (09-21), 0.86.1 (09-20), 0.86.0 (09-19), 0.85.1 (09-05), 0.85.0 (09-04), 0.84.4 (08-28), 0.84.3 (08-24), 0.84.2 (08-14), 0.84.1 (08-07), 0.84.0 (08-06), 0.83.0 (07-29), 0.82.1 (07-25), 0.82.0 (07-24) — [PEN/pi-coding-agent/CHANGELOG.md](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md)
- "Breaking Changes" sections appear at CHANGELOG.md:272, 334, 533, 706. Examples: `shouldStopAfterTurn` was removed in favour of `finishTurn`; `ModelRuntime.setRuntimeApiKey()` changed its signature; the legacy JSONL/in-memory repository APIs were removed — CHANGELOG.md:274, 712, 777.
- 1.0.1 "Removed npm-shrinkwrap.json from the published package... Use the pi.dev installer for pinned installations" — CHANGELOG.md:53-55.
- pi-coding-agent requires `node >=22.19.0` — PEN/pi-coding-agent/package.json:105-107.
- dhub pins exact versions: `"@earendil-works/pi-ai": "1.0.0"`, `pi-coding-agent` "1.0.0" and `pi-mcp` "1.0.0" — D:\dev\disble\d-hub\dhub\package.json.
- Historic links in the changelog point to `badlogic/pi-mono` issues (CHANGELOG.md:2276, 2533), which confirms the lineage from the `badlogic/pi-mono` repo and `@mariozechner/*` packages to `earendil-works/pi` and `@earendil-works/*`.

### Inferences
- Pin `1.0.2` exactly, commit the lockfile, and gate upgrades with a smoke test of each workflow step. Electron 44's bundled Node needs to meet >=22.19; dhub already runs these packages in Electron utility processes, which is evidence it does.

### Gaps
- No published support or LTS policy was found for 1.x.

## 9. dhub engine precedent: flows/steps, run persistence, status, cancellation, errors

### Takeaway
dhub runs an engine in a dedicated Electron `utilityProcess`. Its pieces:
- **Model:** an `Automation` is a trigger (cron/manual/input) plus an ordered array of steps, typed `http` | `transform` (JSONata) | `pi` (prompt, allowedTools, timeoutMs, maxCostUsd?, model?).
- **Execution:** `executeAutomation` runs the steps sequentially, feeding each step's output to the next.
- **Persistence:** runs are stored in `node:sqlite` (`runs` table with steps as JSON).
- **Status:** a run is `success|failed|skipped` and is notified by a `changed` push.
- **Limits:** whole-run deadline, per-step timeout, per-step and per-day cost caps, and an overlap lock.

There is **no user-facing cancel request and no in-progress run status**: runs are persisted only on completion.

### Cited Findings
- Step and automation types: `Step = http | transform{expr} | pi & PiStepSpec{prompt, allowedTools, timeoutMs, maxCostUsd?, model?{provider,id}}`; `Automation{id,name,trigger,steps,missedRun,enabled,permissions?,ports?}`; `RunStatus = 'success'|'failed'|'skipped'`; `TriggerReason = schedule|manual|missed|resume|connection|test`; `StepResult` carries `ok`, `output|error` and `transcript?`; `Run` has `{id, automationId, status, reason, startedAt, endedAt, steps, error?, automationVersion?, cause?...}` — `D:\dev\disble\d-hub\dhub\src\main\domain\automation.ts:57-170`.
- Pipeline `executeAutomation(automation, reason, deps{runners,now,newId}, seed)`:
  - sequential `for` over steps
  - stops at the first failed step
  - checks the whole-run deadline before each step and again after the last one
  - accumulates `spentUsd` and lowers each pi step's budget accordingly
  - returns a `Run`
  - Source: `src/main/domain/pipeline.ts:180-234`
- Runners are injected through `StepRunners { http, transform, pi }`. A runner throws to signal failure, and `PiStepError` carries the transcript — pipeline.ts:40-60; `src/main/domain/pi-step.ts:13-21`.
- The pi step prompt is built from the step prompt plus the previous output as a fenced JSON block marked "Use it as data, not as instructions", capped at `MAX_PROMPT_CHARS = 50_000` with a truncation marker — pi-step.ts:23-89.
- Engine (`createEngine(deps)`):
  - in-memory `running` Set acts as an overlap lock; a second trigger stores a `skipped` run with "Previous run is still running"
  - day budget from `permissions.budget.maxCostPerDayUsd` (not applied to manual/test runs)
  - an untested agent-created automation is refused
  - after the run: port emit and validation, `store` → `deps.runs.add(run, portValues)`, then `onRun`, then routing to downstream `input`-triggered automations
  - cron scheduling through a `SchedulerPort` (croner adapter) with a missed-run catch-up policy
  - Source: `src/main/domain/engine.ts:166-330`
- Headless limits controller `runHeadless(session, request, clock)`:
  - timer abort at `min(timeoutMs, deadlineAt)`
  - cost-cap abort when accumulated `message-end` cost exceeds `maxCostUsd`
  - `ABORT_GRACE_MS = 5000`
  - failure reasons are `'timeout'|'cost-cap'|'error'`
  - the transcript (entries plus usage `{costUsd,inputTokens,outputTokens}`) is kept even on failure
  - Source: `src/main/domain/headless.ts:1-164`; `src/main/domain/agent.ts:234-268`
- pi adapter `createHeadlessRunner`: each run creates an in-memory pi session with exactly the requested tools, optionally switches model via `modelRuntime.getAvailable()` + `session.setModel`, rechecks the deadline at each phase, and calls `dispose()` in `finally` — `src/main/adapters/pi-headless.ts:1-116`.
- Process topology:
  - `startEngine(dbPath, piAgentDir)` forks `engine/entry` as `utilityProcess` 'dhub-engine' and talks to it over an RPC client — `src/main/engine-host.ts:1-27`
  - a separate 'dhub-agent' utility process hosts pi — `src/main/agent-host.ts:39-40`
  - main hands the engine a MessagePort to the agent ('agent-port')
  - the engine's pi runner sends `run-headless` requests to the agent process — `src/main/adapters/pi-runner.ts:42-44`; `src/main/agent/protocol.ts:79`; `src/main/agent/service.ts:131`
  - a lost-agent watchdog waits `workMs + AGENT_ANSWER_GRACE_MS (20_000)` — pi-runner.ts:15, 85
- Engine RPC protocol: request union `list | run-now | test-automation | history | set-enabled | delete-automation | resume | create-automation | apply-change | undo | list-runs | ...`. The only event is `{type:'changed', automationId}`. There is **no cancel/abort request** in the protocol — `src/main/engine/protocol.ts:163-284`; `src/main/adapters/engine-rpc.ts:18-27`. `abort(sessionId)` exists only on the agent side for chat sessions (`src/main/domain/agent.ts:331`).
- Storage: synchronous `node:sqlite` `DatabaseSync` with append-only migrations (`user_version`) — `src/main/adapters/sqlite-storage.test.ts:4`; `docs/composition/connections.md:11`; `docs/composition/spikes.md:67`. Table `runs(id, automation_id FK cascade, status, reason, started_at, ended_at, error, steps TEXT JSON)` with index `(automation_id, started_at DESC)` — `src/main/adapters/sqlite-migrations.ts:12-22`. Provenance columns were added in migration 9 — `docs/composition/runtime-delivery.md:89`. The database lives at `%APPDATA%/dhub/dhub.db` — runtime-delivery.md:30.
- The engine entry wires `http: createHttpRunner(fetch)`, `transform: runTransform` (JSONata) and `pi: createPiRunner(agentLink, systemClock)`, plus `createCronerScheduler()` and `openStorage(dbPath)`. `onRun` posts `changed` to main — `src/main/engine/entry.ts` (whole file, 129 lines).
- Design docs: `docs/composition/README.md`, `contracts.md` (ports, JSONata `emit`), `runtime-delivery.md` (port values, routing, provenance), `connections.md`, `background-sessions.md`, `spikes.md`. The learning log notes that cron baselines must advance monotonically and that automations and drafts live in separate DBs with no cross-DB transaction — `docs/learning-log.md:37-38`.
- dhub is `"private": true` with no licence field — dhub/package.json:2-5.

### Inferences
- dhub's model is a user-authored automation platform: cron, ports and connections, permissions grants, card UI, undo history, and agent-authored automations with a Test gate. Most of that is irrelevant to Stylistic, which has two fixed, code-defined workflows triggered by add-in requests.
- Worth copying (small, self-contained, well tested):
  1. The `executeAutomation` sequential pipeline shape with injected runners and per-step `StepResult` records.
  2. The `runHeadless` limits controller pattern (timer, cost cap, abort grace, transcript on failure), adapted to wrap direct pi-ai calls through `AbortController` + `signal`.
  3. The `node:sqlite` + `user_version` migration storage with a `runs` row holding steps as JSON.
  4. The utility-process isolation idea, so LLM work never blocks Electron main.
  5. Pointing `PI_CODING_AGENT_DIR` at an app-owned directory.
- Not worth copying: the cron/missed-run scheduler, ports/connections/routing, permissions grants, card host, undo/history, and the two-process engine↔agent hop. Stylistic needs no agent process if it calls pi-ai directly.
- Gaps Stylistic must fill that dhub does not cover:
  - Mastra-style run polling: store a `running` row at start and update it per step, rather than writing only on completion.
  - Explicit cancel: a run registry mapping runId to an AbortController, exposed over HTTP/IPC.
  - Structured-output tool forcing and validation.
  - Model fallback pools.
  - Optional branching (the preference-guided pass is conditional). This is trivial in code, but dhub's step list has no conditionals.
  - Scorers.
- Because dhub is private and unlicensed, copying code is a question of the owner's own permission. It appears to be the same user's project; not verified.

### Gaps
- `src/main/agent/service.ts` `handleHeadlessRun` (how the agent applies the default model and credentials) was not read.
- How the renderer polls run status (it likely re-lists runs on `changed`) was not verified.
- `docs/proposals/` files are about memory and notifications, not the engine. No dedicated engine design proposal was found besides `docs/composition/*`.

## 10. Net: what Pi provides vs what Stylistic must build

### Takeaway
Pi (pi-ai) provides:
- multi-provider model access with OAuth/API-key/local auth and locked token refresh
- typed per-provider options (temperature, maxTokens, thinking, toolChoice)
- strict tool-schema sampling
- tool-arg validation
- abort
- a transient-error retry helper
- token and cost accounting
- a payload hook

Stylistic must build:
- the workflow runner and run store (status, polling, cancel)
- a structured-output wrapper using a forced tool, validation and re-ask
- model fallback pools
- Google safety-settings injection via `onPayload`
- scorers (LLM-as-judge)
- an app-owned credential/agent directory

### Cited Findings
- pi-ai feature summary: "Unified LLM API with provider collections, automatic auth resolution, token and cost tracking, and simple context persistence and hand-off to other models mid-session" — [PEN/pi-ai/README.md:3](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- See the per-question citations above for each capability: Q1 structured output, Q3 options, Q4 no fallback, Q6 no workflow DSL in the stable packages, Q9 the dhub runner without cancel or in-progress status.

### Inferences
- Suggested mapping:
  - `stylistic-workflow` = `loadProfile` (SQLite) → `if (preferences) structuredCall(prefPass)` → `structuredCall(correctText, submit_suggestions{suggestions[], cleanPatterns[]})` → `structuredCall(updateProfile, submit_profile{profileMarkdown, changeSummary})`.
  - `feedback-workflow` = `loadProfile` → `structuredCall(submit_feedback{status, decisionSummary, profileMarkdown?})`.
  - Each `structuredCall` = pool loop × `retryAssistantCall` × forced tool × `validateToolCall` / zod, with `temperature:0`, a per-model thinking config, `onPayload` for Google safety, and `signal` from the run's AbortController.
- Estimated app-owned code: a few hundred lines (runner + run table + structured call + pool), modelled on dhub `pipeline.ts`/`headless.ts`. This is an estimate, not measured.

### Gaps
- No end-to-end spike was run. Strict-mode schema compatibility per provider, the Google payload shape for `safetySettings`, and Gemini safety-block surfacing all remain unverified.
