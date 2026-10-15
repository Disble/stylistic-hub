# Reuse before building: the LLM layer of a Pi-based Stylistic backend

Scope: check whether existing tools already cover the five pieces the earlier report said Stylistic must build, so that none of them is reinvented. The five pieces are (1) `structuredCall`, (2) `runWithPool`, (3) Google safetySettings, (4) an app-owned Pi agent dir, (5) the provider login UI. Optional evals are also covered.

Evidence date: 2026-10-15. Local sources:
- `PEN` = `D:\Método PEN\course-platform\node_modules\@earendil-works` (pi 1.0.2)
- `DH` = `D:\dev\disble\d-hub\dhub\node_modules\@earendil-works` (pi 1.0.0)
- `SCR` = files downloaded from GitHub main or developers.openai.com on 2026-10-15 into the session scratchpad. The URLs are given inline.

## Q0. Current Pi version

### Takeaway
npm `latest` for `@earendil-works/pi-ai` is **1.2.0** (2026-10-12). Both local installs are older: 1.0.2 and 1.0.0. Nothing released after 1.0.2 adds structured output, model fallback, or Google safety options.

### Cited Findings
- npm dist-tags are `{'legacy-node20': '0.74.2', 'latest': '1.2.0'}`. Release times:
  - 1.0.3: 2026-10-05
  - 1.0.4: 2026-10-05
  - 1.1.0: 2026-10-07
  - 1.2.0: 2026-10-12
  - Source: [registry.npmjs.org/@earendil-works/pi-ai](https://registry.npmjs.org/@earendil-works/pi-ai)
- `@earendil-works/pi-durable` is published, latest `1.2.0`. This closes a gap left by the earlier notes — [registry.npmjs.org/@earendil-works/pi-durable](https://registry.npmjs.org/@earendil-works/pi-durable)
- I grepped the pi-ai CHANGELOG from `[Unreleased]` down to `[1.0.2]` for `structur|schema|toolChoice|fallback|safety|validateToolCall`. The only hits were Google/OpenCode/Gemini 4 thinking fixes and pricing fixes. Nothing adds structured output, fallback, or safety — [packages/ai/CHANGELOG.md](https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md)
- Relevant post-1.0.2 changes:
  - 1.2.0: "Anthropic `strict: \"prefer\"` tools ... now retry once with preferred tools non-strict" (#10409).
  - Unreleased: "tool calls whose final arguments are malformed JSON ... now carry `argumentsError` and fail validation with the raw arguments text" (#10897).
  - 1.1.0: `LoginOptions.agentName` "replaces pi's name in the Sign in with ChatGPT agent name hint".
  - 1.1.0: `AssistantMessage.durationMs`.
  - Unreleased: model switching now drops thinking blocks from earlier messages produced by a different model (#10995). This is relevant to hand-off and fallback.
  - Source: same CHANGELOG.
- 1.1.0 has a breaking change: "A stream function must return an `AssistantMessageEventStream`" — same CHANGELOG.
- The README on main has no `structured output|responseFormat|completeStructured|outputSchema|safetySettings` APIs. Its only `json_schema` mention is `constrainedSampling: { type: 'json_schema', strict: 'prefer' }` for tools — [packages/ai/README.md](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) (grep, line 552).

### Inferences
- If Stylistic starts now, pin 1.2.0, not 1.0.2. It brings the malformed-args validation fix and the Anthropic strict retry, both of which directly help a forced-tool structured call.

### Gaps
- The full 1.0.3/1.0.4 entries were not read line by line. Only the keyword grep was run.

## Q1. (1) Structured output: does Pi now offer it, and is `structuredCall` still needed?

### Takeaway
No. Pi deliberately does **not** offer response-format structured output. The maintainer rejected it and recommended exactly the forced "submit" tool pattern. Every building block ships in pi-ai: TypeBox tools, `constrainedSampling` strict, per-API forced `toolChoice`, and `validateToolCall`. Only the roughly 50-line glue remains. No library provides that glue on top of Pi. Vercel's official Pi bridge explicitly says "Pi does not support structured output".

### Cited Findings
- Issue #1086, "Add structured output (JSON schema) support", was closed 2026-01-30 by maintainer badlogic, who wrote: "This is still not entirely reliable, and would be special casing specific providers. I do not want to do that in pi-ai. Instead, I propose you expose a tool to the automation agent via an automation specific extension, it must call at the end of its turn, which records the JSON. This is more reliable and supported by all providers." — [earendil-works/pi#1086](https://github.com/earendil-works/pi/issues/1086)
- A later comment in the same thread (michaelmior, 2026-09-16) objects: "I don't believe there's any way to enforce the model calls the tool at the end of its turn." — [#1086](https://github.com/earendil-works/pi/issues/1086). In the agent loop, nothing in core forces the tool. Through direct pi-ai calls, the per-API `toolChoice` can force it (below).
- The provider-neutral `ToolChoice` is only `"auto" | "none"`. The forcing values live in per-API option types:
  - Anthropic `{type:'tool',name}`
  - Google `'any'`
  - Codex `'required'`
  - Source: [PEN/pi-ai/dist/types.d.ts:23] and the api/*.d.ts files, as established in the prior notes at `research_notes/Backend local con Pi y SQLite/pi_orchestration_base.md` §1.
- The Google adapter computes `functionCallingMode` from `options.toolChoice` and strict-mode support, and emits `toolConfig: { functionCallingConfig: { mode } }` — [PEN/pi-ai/dist/api/google-generative-ai.js:296-310](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js)
- On the README for constrained sampling: "Strict JSON-schema constrained sampling is supported for OpenAI, Anthropic, supported Amazon Bedrock Converse models, Mistral, and Gemini 3 tool calls ... Google uses `VALIDATED` function-calling mode (or `ANY` when explicitly requested); earlier Gemini versions fall back for `strict: 'prefer'` and reject `strict: 'require'`" — [PEN/pi-ai/README.md:557](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- The Vercel AI SDK's official Pi integration, `@ai-sdk/harness-pi`, says on its docs page: "Pi does not support structured output". Passing `output` to `HarnessAgent` throws `HarnessCapabilityUnsupportedError` — [ai-sdk.dev/providers/ai-sdk-harnesses/pi](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi)
- `ModelRuntime` (pi-coding-agent) exposes the four call methods plus `login`/`logout`. This closes a gap from the earlier notes:
  - `stream`
  - `complete<TApi>(model, context, options?: ModelsApiStreamOptions<TApi>): Promise<AssistantMessage>`
  - `streamSimple`
  - `completeSimple`
  - Source: [PEN/pi-coding-agent/dist/core/model-runtime.d.ts:98-108](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts)

### Inferences
- "Do not reinvent the wheel" is satisfied by **using Pi's own primitives as the maintainer intended**. `structuredCall` is a thin adapter: build a TypeBox tool, pick the forced `toolChoice` per `model.api`, call `complete`, run `validateToolCall`, and re-ask once with the error as a toolResult. It is not a framework.
- Keep TypeBox as the single schema source. pi-ai re-exports `Type`/`Static`. Adding zod would mean a second schema dialect plus conversion.
- No npm package wrapping this for Pi was found (see Q2 search).

### Gaps
- Strict-mode compatibility of the actual Stylistic schemas per provider is still unspiked. One example is optional fields under OpenAI strict.

## Q2. A Pi ↔ Vercel AI SDK bridge that would give `generateObject` and fallback for free?

### Takeaway
There is an **official** package, `@ai-sdk/harness-pi`, but it goes the wrong direction. It runs Pi *as an agent harness inside* the AI SDK, it requires a sandbox, it is experimental, and it does not support structured output. No published package exposes Pi credentials as an AI SDK `LanguageModel`. Some apps hand-roll such an adapter. Adopting either would contradict "Pi owns providers" and buy nothing for structured output.

### Cited Findings
- `@ai-sdk/harness-pi` facts:
  - latest 1.0.154, created 2026-06-04, Apache-2.0
  - lives in vercel/ai `packages/harness-pi`
  - depends on `@earendil-works/pi-coding-agent ^1.0.3` and `@ai-sdk/harness`, with zod as a peer dependency
  - Its README says: "`HarnessV1` adapter backed by `@earendil-works/pi-coding-agent`. Pi runs in the host Node.js process and uses the sandbox as a remote filesystem + shell"
  - Source: [registry.npmjs.org/@ai-sdk/harness-pi](https://registry.npmjs.org/@ai-sdk/harness-pi)
- What its docs page says:
  - "Pi needs a sandbox session". A local option exists: "a local just-bash session".
  - Auth modes are `auto|openai|anthropic|custom|ai-gateway`, and "Pi's `auth.json` is replaced by the `credentials` option".
  - "Harness packages are experimental".
  - "Pi does not support structured output".
  - Source: [ai-sdk.dev/providers/ai-sdk-harnesses/pi](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi) (fetched and summarized by WebFetch, so the quotes pass through a summarizer)
- Hand-rolled Pi→AI SDK adapters exist inside apps but are not published as packages:
  - `openma-ai/open-managed-agents/apps/agent/src/harness/pi-ai-sdk.ts` imports `LanguageModelV3` from `@ai-sdk/provider` and pi-ai types — [GitHub](https://github.com/openma-ai/open-managed-agents/blob/main/apps/agent/src/harness/pi-ai-sdk.ts)
  - `thunderbird/thunderbolt/shared/agent-core/pi-to-aisdk-stream.ts` — [GitHub](https://github.com/thunderbird/thunderbolt)
  - Both were found with `gh search code`.
- npm searches for "pi-ai ai-sdk", "pi-ai fallback" and "pi-coding-agent openai compatible" returned no standalone Pi-backed AI SDK provider. Hits were the AI SDK packages themselves, `@ai-sdk/harness-pi`, `pi-acp` (an ACP adapter), `@oh-my-pi/pi-coding-agent` (a fork), and DeepSeek harness rc packages — [npm search API](https://registry.npmjs.org/-/v1/search?text=pi-ai%20ai-sdk)
- No evidence was found that Pi exposes an OpenAI-compatible HTTP endpoint. A new `@earendil-works/pi-client` 1.1.0 exists: "Transport-neutral client for remote pi sessions over framed CBOR bytes". That is a session protocol, not OpenAI-compatible — npm search result above.

### Inferences
- Writing or vendoring a Pi→`LanguageModelV3` adapter so that `generateObject` can be used would be *more* custom code than `structuredCall`. It would also re-introduce a second provider abstraction, and AI SDK `generateObject` with `mode:'tool'` does the same forced-tool trick underneath. Not recommended.
- `@ai-sdk/harness-pi` is irrelevant for Stylistic: it is sandbox-oriented, agentic, has no structured output, and is experimental.

### Gaps
- The internals of the hand-rolled adapters were not reviewed for reuse quality. Their licences were not checked.

## Q3. (2) Model fallback: does any Pi feature or small library do it?

### Takeaway
No. Pi has same-model transient retry (`retryAssistantCall`, `settings.retry`) and Anthropic server-side refusal fallback. A cross-provider fallback chain was proposed and **closed as not planned**, with the suggestion that it belongs in an extension. `enabledModels` / model cycling is a manual interactive feature, not failover. `runWithPool` stays app code. It is small: a loop over models around `retryAssistantCall`, which already classifies retryable versus quota errors.

### Cited Findings
- Issue #9242, "Cross-provider fallback chain on transport/unreachable errors", was CLOSED with stateReason NOT_PLANNED on 2026-09-06. It was auto-closed (new contributor policy). A non-maintainer commented: "this feels like an amazing case for extension rather than core addition." — [earendil-works/pi#9242](https://github.com/earendil-works/pi/issues/9242)
- Settings:
  - `enabledModels`: "Model patterns used for startup selection and model cycling"
  - `defaultModel`: "Startup model ID"
  - `retry.enabled`, `retry.maxRetries` (3), `retry.baseDelayMs` (2000), `retry.maxAgentDelayMs` (60000), `retry.provider.maxRetries` (0). The docs say: "Keep `retry.provider.maxRetries` at `0` unless provider-level retries are required. Provider retries can delay Pi from handling quota and usage-limit errors itself."
  - None of these is a fallback list.
  - Source: [PEN/pi-coding-agent/docs/settings.md:7-16, 125-133](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/docs/settings.md); same on main, [docs/settings.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md), where the only "fallback" hit is `defaultProjectTrust`.
- Anthropic server-side fallback: "Added `compat.allowedFallbackModels` configuration for overriding or disabling Anthropic server-side fallback models" (#9294). Also "Added inherited automatic Anthropic server-side refusal fallback for supported first-party models" — [PEN/pi-coding-agent/CHANGELOG.md:348, 545](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md). Issue #9074, "Anthropic mid-output fallback fails the turn instead of recording the handoff", is still open — [#9074](https://github.com/earendil-works/pi/issues/9074)
- Recent retry-classifier fixes widen what counts as transient:
  - "Fixed automatic retry not triggering for gateway `Unable to forward upstream stream` errors" (#10920)
  - `server_busy` (#10543)
  - "The upstream provider returned an error" (#10842)
  - Source: [pi-ai CHANGELOG](https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md)
- On main, model switching mid-conversation now drops the previous model's thinking blocks (#10995). This means Pi itself handles context portability when the model changes — same CHANGELOG.
- `retryAssistantCall(produce, policy, signal, callbacks)` retries only transient errors, fails fast on quota/billing, and never retries an abort — [PEN/pi-ai/dist/utils/retry.d.ts:1-47](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/utils/retry.d.ts) (via the prior notes §3)
- No small, Pi-compatible fallback library was found on npm ("pi-ai fallback" search) — [npm search](https://registry.npmjs.org/-/v1/search?text=pi-ai%20fallback)

### Inferences
- `runWithPool` should be a for-loop around `retryAssistantCall`, falling through on "exhausted or non-retryable or validation-failed". It is roughly 30 lines and owns no provider logic. Generic "AI fallback" libraries are built for AI SDK models and would require the AI SDK bridge rejected in Q2.

### Gaps
- No maintainer statement on #9242 was found. The issue may be reopened later.

## Q4. (3) Google safety settings in Pi; how `onPayload` works

### Takeaway
pi-ai does not model `safetySettings`, including on main/1.2.0, and no issue requests it. `onPayload` is the supported hook. It receives the exact `@google/genai` `generateContentStream` params `{model, contents, config}`. Returning a new object replaces those params. Injecting `config.safetySettings` is therefore a verified, roughly 5-line shim, not a reinvention.

### Cited Findings
- The signature is `onPayload?: (payload: unknown, model: TModel) => unknown | undefined | Promise<unknown | undefined>` — [PEN/pi-ai/dist/types.d.ts:80](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/types.d.ts)
- Call site in the Google adapter — [PEN/pi-ai/dist/api/google-generative-ai.js:44-49](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js):
  ```
  let params = buildParams(model, normalizedContext, options);
  const nextParams = await options?.onPayload?.(params, model);
  if (nextParams !== undefined) { params = nextParams; }
  const googleStream = await retryGoogleRequest(() => client.models.generateContentStream(params), options);
  ```
  The same pattern is in `google-vertex.js:48`.
- `buildParams` returns `{ model: model.id, contents, config }`, where `config` holds `temperature`, `maxOutputTokens`, `systemInstruction`, `tools`, `toolConfig`, `thinkingConfig` and `abortSignal`. It holds no safetySettings — [google-generative-ai.js:285-335](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/api/google-generative-ai.js)
- In `@google/genai`, `GenerateContentConfig` (declared at genai.d.ts:5565) has `safetySettings?: SafetySetting[]` at line 5677 — [PEN/../@google/genai/dist/genai.d.ts](file:///D:/Método%20PEN/course-platform/node_modules/@google/genai/dist/genai.d.ts). So `p.config.safetySettings` is the correct location.
- A grep for `safetySettings` across pi-ai/dist returned nothing (local, 1.0.2). `gh search issues safetySettings --repo earendil-works/pi` returned no results.
- Gemini finish reasons `SAFETY`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII` and `RECITATION` are all grouped in `mapStopReason`, separate from `STOP` and `MAX_TOKENS` — [PEN/pi-ai/dist/api/google-shared.js:383-400](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/dist/api/google-shared.js). The returned StopReason for that group was not read (it is most likely `"error"`).

### Inferences
- Shim: `onPayload: (p, m) => hasApi(m,'google-generative-ai') || hasApi(m,'google-vertex') ? { ...p, config: { ...p.config, safetySettings } } : undefined`. Return `undefined` for other APIs so their payloads stay untouched.
- A safety-blocked response arrives as a non-`stop` stopReason. `runWithPool` can treat it as "fall through to the next model".

### Gaps
- The exact StopReason value and errorMessage for a SAFETY block were not confirmed (line 401+ not read). No live spike was run.

## Q5. (4) App-owned Pi agent dir and (5) provider login UI: what Pi ships vs what dhub/course-platform wrote

### Takeaway
Pi ships the **login protocol and state handling**: `ModelRuntime.login(providerId, type, interaction{prompt, notify, signal})`, an injectable credential store, locked auto-refresh, and `ModelRuntime.create({authPath, modelsPath})`. The only ready-made **UI** is the terminal TUI dialog in pi-coding-agent. No web or React components exist. Both precedents therefore wrote their own glue:
- dhub: a 339-line event/state-machine domain module plus a 53-line adapter
- course-platform: a 936-line credentials module plus a small `createAppOwnedModelRuntime`

Stylistic can copy the dhub `login.ts` shape, which is provider-neutral and already structurally matches Pi's `AuthInteraction`, rather than design a new one.

### Cited Findings
- pi-ai: "Each of these providers carries an `OAuthAuth` ... `login(interaction)` uses the provider-neutral `AuthInteraction.prompt()`/`notify()` protocol". Prompt types are `'text' | 'secret' | 'select' | 'manual_code'`. Notify events are `'info' | 'auth_url' | 'device_code' | 'progress'`. "Refresh is automatic ... under a credential-store lock" — [PEN/pi-ai/README.md:1728-1772](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- "Built-in login and refresh flows are private provider implementations. Use provider-owned `OAuthAuth`" — README.md:1808-1810.
- `ModelRuntime.login(providerId, type: AuthType, interaction: AuthInteraction, options?: LoginOptions): Promise<Credential>` and `logout(providerId, options?)` — [PEN/pi-coding-agent/dist/core/model-runtime.d.ts:107-108](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts). 1.1.0 adds `LoginOptions.agentName` — [pi-ai CHANGELOG](https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md)
- The UI components that ship are TUI only: `modes/interactive/components/login-dialog.d.ts`, `oauth-selector.d.ts`, `radius-login-selector.d.ts` — local ls of PEN/pi-coding-agent/dist/modes/interactive/components.
- What dhub wrote:
  - `src/main/domain/login.ts` (339 lines) defines `LoginPrompt`, `LoginNotice`, `LoginEvent` (`login-notice|login-prompt|login-prompt-closed|login-done|login-failed`) and `LoginInteraction`, commented as "a structural match for the SDK's". It also defines `createLoginManager(deps)` with `start/answerPrompt/cancelPrompt/cancelLogin`, stale timeouts, `REPLACE_WAIT_MS = 3000`, `DEVICE_CODE_GRACE_MS = 60_000`, and notice redaction — `D:\dev\disble\d-hub\dhub\src\main\domain\login.ts:1-60, 62-76, 123-126, 129, 179`
  - `src/main/adapters/pi-login.ts` (53 lines) reuses Pi: `await modelRuntime.login(providerId, type, interaction, { getDeviceId: () => installationId(agentDir) })` and `logout: (providerId) => modelRuntime.logout(providerId)` — `pi-login.ts:38-52`
- What course-platform wrote:
  - `server/pi-runtime.ts:38-55` has `createAppOwnedModelRuntime({authPath, modelsPath, agentDir})`, which runs `mkdir(agentDir)` then `ModelRuntime.create({ authPath, modelsPath })`. This is reuse plus about 10 lines.
  - `server/assistant/credentials.ts` (936 lines) adds:
    - 0600 file-mode handling (`CREDENTIAL_FILE_MODE`, line 36)
    - an `auth.json` import from the Pi CLI restricted to files named `auth.json` (lines 154-171)
    - an installation id for device-code login (line 131)
    - admin-facing `AdminAuthInteraction`/`AdminRuntime` structural subsets of `ModelRuntime` (lines 294-321)
    - a model recommendation helper (line 194)
    - Source: `D:\Método PEN\course-platform\server\assistant\credentials.ts`
- Pi's agent dir is set via `PI_CODING_AGENT_DIR` or the SDK `agentDir`. The stores are injectable (`AuthStorage.create/fromStorage/inMemory`) — prior notes §7, citing PEN/pi-coding-agent/docs/configuration.md:7-24 and auth-storage.d.ts:49-51.

### Inferences
- Piece (4) is not a build item. It is `ModelRuntime.create({authPath, modelsPath})` under `%APPDATA%/stylistic/pi`, the same roughly 10 lines as course-platform.
- Piece (5) needs only an HTTP/IPC transport for prompt/notify events and the add-in task-pane UI. Copy dhub's `login.ts` contract, which is tested and provider-neutral, if the owner permits; dhub is private and unlicensed. Do not port course-platform's 936-line admin module, which is mostly admin-console specifics.
- Pass `getDeviceId` (dhub precedent) for Sign in with ChatGPT. It corresponds to OpenAI's `ext_agent_host_id` (Q6). That mapping is inferred, not verified in Pi source.

### Gaps
- `ModelRuntime.create` was not checked for whether it accepts an injected `AuthStorage` or `CredentialStore` (for a SQLite-backed store).

## Q6. ChatGPT/Codex subscription provider and `gpt-5.6-sol`

### Takeaway
Yes, both are present. "Sign in with ChatGPT" is an OAuth mode of the regular `openai` provider. `openai-codex` is marked legacy. Both catalogues list `gpt-5.6-sol`, alongside `gpt-5.6-luna/terra` and the GPT-6 family (`gpt-6-sol`, `gpt-6.1-sol`, ...). `gpt-5.6-sol` is no longer the newest.

### Cited Findings
- From the README: "**OpenAI** (Sign in with ChatGPT: uses the ChatGPT subscription with the OpenAI API)" and "**OpenAI Codex (legacy)**: Superseded by Sign in with ChatGPT on the OpenAI provider. Requires a ChatGPT Plus or Pro subscription." — [PEN/pi-ai/README.md:1733, 1814](file:///D:/Método%20PEN/course-platform/node_modules/@earendil-works/pi-ai/README.md)
- `dist/providers/data/openai-codex.json` (key `openai-codex-responses`) has keys: `chat:gpt-5.3-codex-spark`, `chat:gpt-5.5`, `chat:gpt-5.6-luna`, `chat:gpt-5.6-sol`, `chat:gpt-5.6-terra`, `chat:gpt-6-astra`, `chat:gpt-6-luna`, `chat:gpt-6-sol`, `chat:gpt-6.1-sol` — local python read of PEN/pi-ai 1.0.2.
- `dist/providers/data/openai.json` (`openai-responses`) contains `chat:gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-6-astra`, `gpt-6-luna`, `gpt-6-sol` and `gpt-6.1-sol` — same local read.
- On main: "Fixed `openai-codex/gpt-6.1-sol` using a 272K context window instead of the 500K window Codex now provides" (#10840). Also, the `openai-decisions` classifier "needs an API key, so it is not listed as available while `openai` uses Sign in with ChatGPT" (1.1.0) — [pi-ai CHANGELOG](https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md)

### Inferences
- Target `openai` + Sign in with ChatGPT, not the legacy `openai-codex` provider.

### Gaps
- Which model is Pi's or Codex's *default* for the subscription was not determined. No default-model constant was found by grep in `providers/openai-codex.js`.

## Q7. Primary-source policy: OpenAI Sign in with ChatGPT vs Anthropic OAuth in third-party apps

### Takeaway
**OpenAI now explicitly permits** ChatGPT plan usage in open-source and locally hosted third-party apps, through a dynamic-registration OAuth flow. Paid or remotely hosted apps must apply through an interest form. **Anthropic explicitly forbids** third-party apps from offering Claude.ai login or routing through Pro/Max credentials. For a non-open-source or paid Stylistic, Claude must be API key only, and ChatGPT plan usage requires OpenAI's approval.

### Cited Findings
- OpenAI, *ChatGPT plan usage in your open-source app*:
  - "ChatGPT plan usage is an optional capability within Sign in with ChatGPT. In addition to identity scopes, your open-source app can request permission to use the user's ChatGPT plan for eligible Responses API requests."
  - "These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you're interested in offering it in a paid or remotely hosted app, complete the interest form."
  - "The OAuth flow for OSS clients registers a **user-defined agent** during Sign in with ChatGPT. Before the first sign-in, choose and persist the required `ext_agent_host_id`."
  - Source: [developers.openai.com/siwc/token-sharing-open-source](https://developers.openai.com/siwc/token-sharing-open-source.md)
- OpenAI, *Quickstart*:
  - "Sign in with ChatGPT is currently available to selected commercial partners through a limited trial. ChatGPT plan usage is available to all open-source partners and selected private clients."
  - The open-source flow "registers your client and issues OAuth credentials for eligible Responses API requests, without a client secret or partner API key."
  - Source: [developers.openai.com/siwc/quickstart](https://developers.openai.com/siwc/quickstart.md)
- OpenAI, *Request a client ID*: "Sign in with ChatGPT is currently offered to a select group of commercial partners. To join the waitlist, complete the Sign in with ChatGPT interest form." — [developers.openai.com/siwc/request-client-id](https://developers.openai.com/siwc/request-client-id.md)
- Secondary coverage dates the expansion to DevDay, 2026-09-29. Usage counts against the user's plan limits, with per-app weekly caps — [The New Stack](https://thenewstack.io/sign-in-with-chatgpt/). This is secondary and was not verified on an OpenAI page.
- Anthropic, *Legal and compliance*:
  - "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."
  - "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."
  - "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice."
  - Source: [code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)

### Inferences
- In Stylistic, hide Pi's `anthropic` OAuth login and offer only an Anthropic API key. Pi exposes both; the app chooses which providers and auth types to show.
- Sign in with ChatGPT: if Stylistic is open source and locally hosted, it is eligible under the OSS flow, provided Pi's ChatGPT login uses that dynamic-registration flow with `ext_agent_host_id` (the dhub `getDeviceId` hint suggests it does). If it is closed or paid, file OpenAI's interest form before shipping.

### Gaps
- It was not verified that Pi's built-in Sign in with ChatGPT flow *is* OpenAI's sanctioned OSS dynamic-registration flow rather than reuse of the Codex CLI client id. The 1.1.0 "agent name hint" and "Codex browser login originator" entries point to both mechanisms existing. This matters for compliance and needs a check of `pi-ai/dist/providers/openai*.js` auth code.
- The OpenAI UI/UX guidelines page (required plan-usage UX) was not read.
- No OpenAI developer-forum staff statements were collected. The official docs above supersede them.
- Stylistic's licence and distribution model (open source? paid?) is unknown to me.

## Q8. Evals (replacement for Mastra scorers), offline-capable with Pi

### Takeaway
Mature options exist. None integrates with Pi natively; each needs a small "call my Pi `structuredCall`" task function or a custom judge provider. The best fit for a TypeScript/Vitest repo with no extra framework is `vitest-evals` or `evalite`, with LLM-judge scorers written as Pi calls. `promptfoo` suits CLI or YAML matrices and supports custom JS providers.

### Cited Findings
- `promptfoo` 0.124.1 (2026-10-08, MIT): "LLM eval & testing toolkit". It depends on `ai`, `openai` and `@anthropic-ai/sdk` — [npm](https://registry.npmjs.org/promptfoo)
- `evalite` 0.19.0 (2025-11-06, no licence field in package.json): "TypeScript-native, Vitest-based eval runner. No API key required." It depends on `@ai-sdk/provider` — [npm](https://registry.npmjs.org/evalite). Its last release is about 11 months old.
- `vitest-evals` 0.17.0 (2026-09-10, Apache-2.0): "Harness-backed AI testing on top of Vitest." Peer dependencies are `ai`, `zod`, `vitest` and `tinyrainbow` — [npm](https://registry.npmjs.org/vitest-evals)
- `autoevals` 0.4.0 (2026-10-07, MIT): "Universal library for evaluating AI models". It depends on `openai`, with zod as a peer — [npm](https://registry.npmjs.org/autoevals)

### Inferences
- Deterministic scorers (schema validity, span offsets within the text, category enum) need no library: plain Vitest assertions. Only LLM-as-judge scorers need a model call, which is one more Pi `structuredCall`.
- The `ai`/`openai` dependencies of these tools are only needed for their built-in judges. Using a custom task or judge keeps Pi as the only provider layer.

### Gaps
- Whether `vitest-evals` or `evalite` scorers can take an arbitrary async judge without the AI SDK was not verified from their READMEs. The evalite licence was not resolved.
