# Mastra workflow parity spec (stylistic-workflow + feedback-workflow)

Citation legend: `B/` = `D:\dev\eln\stylistic\stylistics-backend\src\`, `A/` = `D:\dev\eln\stylistic\stylistic-addon\src\`. Every "Source" is a local code location `path:line` (read-only research; no `.env` read). Versions: backend `@mastra/core ^1.63.2`, `zod 4` (`stylistics-backend/package.json:52,67`); add-in `@mastra/client-js ^1.42.4` (`stylistic-addon/package.json:43`).

## 1. Workflow structure, step ids, schemas and control flow

### Takeaway
Both workflows are plain linear `.then()` chains with no branching DSL; every conditional behaviour (skipping preferences, ignoring comment-less feedback) is an early `return` inside a step. stylistic-workflow = `load-author-profile → preference-guided-correction → correct-text → update-profile`; feedback-workflow = `load-author-profile → process-feedback`.

### Cited Findings
**stylistic-workflow**
- Workflow id `stylistic-workflow`, input `stylisticWorkflowInputSchema`, output `stylisticWorkflowOutputSchema`, steps chained `.then(loadAuthorProfile).then(preferenceGuidedCorrection).then(correctText).then(updateProfile)` then `.commit()` — [B/mastra/workflows/stylistic/stylistic-workflow.ts:17-27]
- **Workflow input** (`stylisticWorkflowInputSchema`): `text: z.string()`; `documentUuid: z.uuid()`; `genero: z.enum(DOCUMENT_GENRES).default("general")`; `title: z.string().trim().min(1).optional()`; `processingConfig: z.record(z.string(), z.unknown()).optional()` — [B/mastra/workflows/stylistic/steps/load-author-profile/load-author-profile.schemas.ts:10-31]
- `DOCUMENT_GENRES = ["narrativa-literaria","ensayo-academico","periodismo-cultural","general"]`, `DEFAULT_DOCUMENT_GENRE = "general"`, `DEFAULT_DOCUMENT_PROCESSING_CONFIG = { chunking: { mode: "default" } }` — [B/domain/documents/document.constants.ts:1-14]
- **Step 1 `load-author-profile`** in = workflow input; out = input + `authorProfile: string`, `authorProfileCorrectionPatternsWordCount: int ≥0`, `documentContext {documentId, documentStyleProfileId, documentPreferencesId, documentUuid (all uuid), defaultGenre (enum), processingConfig (record)}` — [B/mastra/workflows/stylistic/steps/load-author-profile/load-author-profile.schemas.ts:33-63]
- Step 1 throws `"Authenticated user is required to resolve document profile context."` when `requestContext.get("user")?.user.id` is missing; calls `resolveDocumentContext({userId, externalDocumentKey: documentUuid, title, defaultGenre: genero, processingConfig})`; returns `{...inputData, authorProfile: styleProfile.profileMarkdown, authorProfileCorrectionPatternsWordCount, documentContext}` — [B/mastra/workflows/stylistic/steps/load-author-profile/load-author-profile.step.ts:16-83]
- **Step 2 `preference-guided-correction`** in = step-1 output; out = `correctTextInputSchema` = step-1 output + `previousCorrection: stylisticWorkflowOutputSchema.nullable()` — [B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.schemas.ts:4-5], [B/mastra/workflows/stylistic/steps/correct-text/correct-text.schemas.ts:104-113]
- Step 2 pass-through: reads `userPreferencesRepository.getUserPreferences(userId).correctionInstructions` (null if no user); if falsy returns `{...inputData, previousCorrection: null}` with no LLM call — [B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.step.ts:40-59]
- Step 2 otherwise calls `stylisticAgent.generate(prompt, buildGenerateOptions(genero))`, throws `"No output structured received from preference-guided correction"` if `result.object` missing, returns `{...inputData, previousCorrection: normalizeWorkflowOutput(result.object)}` — [same file:61-157]
- `correctionInstructions` normalised by `trim()`; empty → `null` — [B/infrastructure/persistence/repositories/user-preferences.repository.ts:15-36]
- **Step 3 `correct-text`** in = `correctTextInputSchema`; out = `stylisticCorrectionStepSchema` = `{suggestions, cleanPatterns, documentContext, authorProfile, authorProfileCorrectionPatternsWordCount}` — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.schemas.ts:116-146]
- Step 3 always calls `stylisticAgent`; throws `"Stylistic agent not found"` / `"No output structured received from stylistic agent"`; returns normalised suggestions + cleanPatterns + carried context — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.ts:49-172]
- **Step 4 `update-profile`** in = `stylisticCorrectionStepSchema`; out = `stylisticWorkflowOutputSchema` `{suggestions, cleanPatterns}`; calls `documentProfileAgent`, requires structured `{profileMarkdown: string.min(1), changeSummary: string.min(1)}`, persists `profileMarkdown`, returns original suggestions/cleanPatterns unchanged — [B/mastra/workflows/stylistic/steps/update-profile/update-profile.schemas.ts:6-15], [B/mastra/workflows/stylistic/steps/update-profile/update-profile.step.ts:19-85]
- **Suggestion schemas**: category enum `ortografia|gramatica|puntuacion|tipografia|lexico|estilo`; base `{context: string, anchor: string, justification: string, category, severity: "high"|"medium"|"low"}` `.strict()`; portable (LLM transport) adds `type: "track-change"|"comment-only"`, `suggestedText?: string`; internal union = track-change `{…, type:"track-change", suggestedText: string}` | comment-only `{…, type:"comment-only"}` (no suggestedText, strict) — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.schemas.ts:10-73]
- Output: `{suggestions: array, cleanPatterns: string[]}` (both portable and normalised variants) — [same file:76-101]
- `documentContext.defaultGenre` enum is re-declared inline in correct-text schemas (same four values) — [same file:118-130]

**feedback-workflow**
- Workflow id `feedback-workflow`, input `feedbackWorkflowInputSchema`, output `processFeedbackOutputSchema`, `.then(loadAuthorProfile).then(processFeedback)` — [B/mastra/workflows/feedback/feedback-workflow.ts:13-21]
- **Input**: `category: string.min(1)` (NOT an enum), `context: string.min(1)`, `anchor: string.min(1)`, `suggestedText?: string`, `justification: string`, `action: "accept"|"reject"`, `severity: "high"|"medium"|"low"`, `suggestionType: "track-change"|"comment-only"`, `comment?: string`, `documentUuid: uuid` — [B/mastra/workflows/feedback/steps/load-author-profile/load-author-profile.schemas.ts:10-29]
- Step `load-author-profile` (feedback variant) calls `resolveDocumentContext({userId, externalDocumentKey})` only (no title/genre/config) and outputs input + `authorProfile` + `documentContext` (no word count) — [B/mastra/workflows/feedback/steps/load-author-profile/load-author-profile.step.ts:30-74], [same dir/load-author-profile.schemas.ts:41-47]
- Step `process-feedback`: if `!inputData.comment` → returns `{received: true, receivedAt: ISO}` without LLM; else calls `documentFeedbackAgent` with structured output `{status: "updated"|"ignored", decisionSummary: string.min(1), profileMarkdown?: string.min(1)}`; if `updated` and no markdown → throws `"Document feedback agent returned an updated status without profile markdown."`; persists only on `updated`; returns `{received: true, receivedAt}` — [B/mastra/workflows/feedback/steps/process-feedback/process-feedback.step.ts:23-121], [B/mastra/workflows/feedback/steps/process-feedback/process-feedback.schemas.ts:8-18]

### Inferences
- Because `genero` has `.default("general")`, `defaultGenre` is ALWAYS passed to `resolveDocumentContext` in the stylistic path, so every analysis run overwrites `document_preferences.default_genre` with the chunk's genre (see section 4).
- The workflow output stored as run `result` is step 4's `{suggestions, cleanPatterns}`; the add-in only consumes `suggestions` (section 5). `cleanPatterns` exists only to feed update-profile.
- Step 4 is serial and blocking: a profile-agent failure fails the whole run, so the user gets no suggestions even when correct-text succeeded. A 1:1 replica must keep this, or the change must be a deliberate decision.

### Gaps
- `stylisticWorkflowOutputSchema` is imported in stylistic-workflow.ts from `./steps`; I did not check whether Mastra re-validates the final output against it at runtime.

## 2. Prompts and agent instructions/skills

### Takeaway
All prompts are Spanish XML-tagged templates. The stylistic steps share an intro (fiction frame + genre rules), a long `SUGGESTION_TYPES_SECTION` and an inline profile block. Profile/feedback prompts embed the full profile markdown in `~~~markdown` fences plus JSON payloads. Agent "skills" are static TS string constants inlined into the system instructions; they are not Mastra workspace skills.

### Cited Findings
- `buildPromptIntroduction(genero)`: for `narrativa-literaria` it prepends `FICTION_EDITORIAL_FRAME` (`<marco-editorial>`), then `GENRE_RULES[genero]` (`<criterios-genero>`, defined for narrativa-literaria, ensayo-academico and periodismo-cultural, none for general), joined by `\n\n` with a trailing `\n\n`, or `""` — [B/mastra/workflows/stylistic/steps/stylistic-correction-prompt.ts:12-26], [B/mastra/workflows/stylistic/steps/stylistic-correction-prompt.constants.ts:4-26]
- `buildAuthorProfileSection(profile)`: `<perfil-autor>` with a "máxima prioridad… checklist activo… NO uses herramientas" preface + the profile, or a "No hay perfil previo" variant when the profile is falsy — [B/mastra/workflows/stylistic/steps/stylistic-correction-prompt.ts:29-38]
- `SUGGESTION_TYPES_SECTION` (`<tipos-sugerencia>`): the type/category contract, the anchor⊂context rule, the 4 valid `suggestedText` forms (plain text, `""` delete, `*anchor*` italic, `**anchor**` bold) with JSON examples, forbidden errors and a 4-item checklist — [B/mastra/workflows/stylistic/steps/stylistic-correction-prompt.constants.ts:29-86]
- **Preference prompt** order: intro → `<contrato>` (only explicit preferences, no global correction, empty arrays allowed) → SUGGESTION_TYPES → `<preferencias-usuario>{correctionInstructions}` → `<criterio-operativo>` → `<perfil-autor>` → `<genero>` → `<texto-corregir>{text}` → `<respuesta-final>` — [B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.prompt.ts:12-54]
- **Correct-text prompt** order: intro → `<contrato>` (integrated correction) → SUGGESTION_TYPES → optional `<correcion-previa>` (JSON.stringify(suggestions,null,2) in `<suggestions>`, cleanPatterns in `<clean-patterns>`, "NO copies mecánicamente") → `<perfil-autor>` → `<genero>` → `<texto-corregir>` → `<respuesta-final>`. `title` and `processingConfig` are not injected into any prompt — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.prompt.ts:12-69]
- **Update-profile prompt**: `<contrato>` (profile id, safe-write policy, preserve the 6 `###` subsections of `## PATRONES VIVOS`) → `<perfil>` fenced markdown → `<metricas>` (word count + zone) → `<datos>` (suggestions + cleanPatterns JSON) → `<respuesta-final>` — [B/mastra/workflows/stylistic/steps/update-profile/update-profile.helpers.ts:33-69]
- Word-count zones: min 550, max 800; `>800` → "ZONA ROJA. Compacta…"; `≥550` → "ZONA AMARILLA…"; else "ZONA VERDE" — [B/mastra/workflows/stylistic/steps/update-profile/update-profile.helpers.ts:3-30]
- **Process-feedback prompt**: `<contract>` (RAZONAR→DECIDIR→ACTUAR, preserve canonical structure) → `<profile>` fenced → `<payload>` JSON of `{category, context, anchor, suggestedText, justification, action, severity, suggestionType, comment}` → `<final-response>` — [B/mastra/workflows/feedback/steps/process-feedback/process-feedback.prompt.ts:7-47]
- `STYLISTIC_AGENT_INSTRUCTIONS` (7,207 bytes, 90 lines): `<rol>` (Alberto Bustos method), `<contrato>`, `<directivas>`, `<estandares>` (RAE/Fundéu/Montolío), `<criterios-calidad>`, `<focos>`, `<tipos-canonicos>` (6 categories), `<niveles-severidad>` (A/B/C → high/medium/low), `<justifications>` (funcional/diagnóstica), `<contexto-autor>` checklist protocol (suggestions XOR cleanPatterns), `<respuesta-final>` — [B/mastra/agents/stylistic-agent.prompt.ts:2-90]
- `DOCUMENT_PROFILE_AGENT_INSTRUCTIONS` = header + `<rol>` + `<protocolo>${PROFILE_AGENT_SKILL}</protocolo>` + `<adaptacion-documental>` (reinterpret `autores/{slug}.md` as inline markdown) + `<input>` + `<contrato>` + `<respuesta-final>` — [B/mastra/agents/document-profile-agent.prompt.ts:2-35]
- `PROFILE_AGENT_SKILL` (8,613 bytes, 193 lines) sections: canonical scope, canonical structure, taxonomy, input, normal update protocol (OBSERVAR/TRANSICIONAR/PODAR), compaction, pattern format, traffic-light system (🔴/🟡/🟢 transition table), intervention criteria, safe-write policy (PATCH CONSERVADOR, allowed/forbidden deletes, abort), absolute prohibitions — [B/mastra/agents/profile-agent.skill.ts:2-190]
- `DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS` wraps `FEEDBACK_AGENT_SKILL` the same way — [B/mastra/agents/document-feedback-agent.prompt.ts:2-34]
- `FEEDBACK_AGENT_SKILL` (8,560 bytes, 183 lines): intent table CRITERIO / CONTEXTUAL / VAGO; CRITERIO → write a plain bullet into `## CRITERIOS DE INTERVENCIÓN` with semantic dedupe, never touches `## PATRONES VIVOS`; CONTEXTUAL/VAGO → no update; plus write format, confirmation and safe-write policy — [B/mastra/agents/feedback-agent.skill.ts:49-125]
- Legacy `profile-agent.prompt.ts`/`feedback-agent.prompt.ts` (workspace-file variants) exist but these workflows do not use them; only the `document-*` agents are referenced — [B/mastra/index.ts:21-25,198-204]
- Initial profile template = `# Perfil estilístico del documento` / `## PATRONES VIVOS` with `### Ortografía, Gramática, Puntuación, Tipografía, Léxico, Estilo` / `## CRITERIOS DE INTERVENCIÓN` — [B/domain/documents/document.constants.ts:16-33]

### Inferences
- Parity needs byte-identical templates. The cheapest path is to copy the `.prompt.ts`, `.skill.ts` and `*.constants.ts` files verbatim and pass the composed string as the Pi agent's system prompt.

### Gaps
- I did not read the full text of the OBSERVAR/TRANSICIONAR/PODAR and compaction subsections (profile-agent.skill.ts:66-123). They are static text, so copying them verbatim is enough.

## 3. LLM call options, model pool, error translation, normalisation, word count

### Takeaway
The steps request `structuredOutput` (zod schema), `temperature: 0`, and Google thinking/safety options for `narrativa-literaria`. **However, the default backend (`MODEL_BACKEND` unset) routes every agent to a custom Codex-direct model (`gpt-5.6-sol`) that drops temperature and providerOptions, and has no model-array fallback.** The Gemini/OpenAI pools with `maxRetries: 3` apply only when `MODEL_BACKEND=metered`.

### Cited Findings
- `buildGenerateOptions(genero)` → `{structuredOutput: {schema: portableStylisticWorkflowOutputSchema}, modelSettings: {temperature: 0}, providerOptions}`, where `providerOptions.google = {thinkingConfig: {thinkingLevel: "high"}, safetySettings: [HARASSMENT, HATE_SPEECH, SEXUALLY_EXPLICIT, DANGEROUS_CONTENT → BLOCK_NONE]}` only for `narrativa-literaria` — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.helpers.ts:190-218], [B/mastra/workflows/stylistic/steps/correct-text/correct-text.constants.ts:9-26]
- Both stylistic LLM steps use these same options — [B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.step.ts:85], [B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.ts:91]
- update-profile and process-feedback pass only `{structuredOutput: {schema}}`: no temperature, no provider options — [B/mastra/workflows/stylistic/steps/update-profile/update-profile.step.ts:48-52], [B/mastra/workflows/feedback/steps/process-feedback/process-feedback.step.ts:81-85]
- Model pools (metered): stylistic-agent = `[google/gemini-3.5-flash, google/gemini-3.1-flash-lite, openai/gpt-5.4]`, each `maxRetries: 3`; profile-agent = `[google/gemini-3.1-flash-lite, opencode-go/deepseek-v4-flash, openai/gpt-5.4-nano]`, each `maxRetries: 3`; feedback-agent = `lmstudio/qwen3.6-35b-a3b@q2_k_xl` (single). Each entry is wrapped by `withCodexBackend(...)` — [B/mastra/constants/models.ts:5-49]
- `withCodexBackend`: `MODEL_BACKEND=metered` → pool; `=codex` → Codex SDK transport; anything else, including unset → `createCodexDirectLanguageModel` — [B/mastra/agents/codex-subscription/codex-subscription.selector.ts:38-56], [B/mastra/agents/codex-subscription/codex-subscription.constants.ts:35-45]
- Codex-direct default model `gpt-5.6-sol`, endpoint `https://chatgpt.com/backend-api/codex/responses` — [B/mastra/agents/codex-direct/codex-direct.constants.ts:18-25]
- Codex-direct request body = `{model, instructions (system msgs), input, stream: true, store: false, text: json_schema format when responseFormat.type==="json"}`. It contains no temperature or providerOptions (no `temperature`/`providerOptions` reference in non-test codex-direct files) — [B/mastra/agents/codex-direct/codex-direct.protocol.ts:75-110]
- Safety-block translation `getGoogleSafetyBlock(error)` walks the `error.cause` chain and parses `current.value` or JSON `current.responseBody` for `promptFeedback.blockReason` (+ safetyRatings, usageMetadata, statusCode/name/message) — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.helpers.ts:22-126]
- Re-thrown messages: `Google/Gemini blocked stylistic correction (blockReason=…, documentUuid=…, genero=…)` and `Google/Gemini blocked preference-guided correction (…)`, with `{cause}`; other errors propagate unchanged — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.ts:109-134], [B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.step.ts:100-124]
- Normalisation `normalizeSuggestion`: comment-only → drop `suggestedText`; track-change with non-string `suggestedText` OR `suggestedText === anchor` → downgrade to comment-only (drop suggestedText); else keep track-change. `normalizeWorkflowOutput` = parse portable schema → map → parse internal schema — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.helpers.ts:132-184]
- The backend does NOT enforce `anchor ⊂ context`; the rule exists only in the prompt — [B/mastra/workflows/stylistic/steps/stylistic-correction-prompt.constants.ts:34], [B/mastra/workflows/stylistic/steps/correct-text/correct-text.helpers.ts:132-159]
- Word count of `## PATRONES VIVOS`: body runs from the end of the heading literal to the next `^##\s+` (global regex with `lastIndex` set) or EOF, trimmed; `""` if the heading is absent; words = `/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu` match count — [B/mastra/workflows/stylistic/steps/load-author-profile/load-author-profile.helpers.ts:6-45]

### Inferences
- `^##\s+` does NOT match `### …` (the third `#` is not `\s`), so the section ends at the next level-2 heading (`## CRITERIOS DE INTERVENCIÓN`), and the six subsection titles (`Ortografía`… `Estilo`) count as words. An empty template therefore counts 6 words. A replica must reproduce this exactly.
- For parity on Pi, decide which backend is "the" reference: default Codex-direct (no temperature/safety) or metered Gemini (temperature 0 + safety/thinking + 3-model fallback). The code supports both. The Google safety-block translation only matters for a Gemini provider.

### Gaps
- I did not verify how Mastra applies `maxRetries` and array fallback ordering (retry each model 3x, then fall to the next); that is Mastra-internal behaviour, not in this repo.
- I did not verify whether `structuredOutput` on the Codex model uses native `json_schema` or the `FORMATO DE SALIDA OBLIGATORIO` prompt contract (`CODEX_JSON_CONTRACT_HEADING`, codex-subscription.constants.ts:29 is SDK-transport only).

## 4. Persistence touched per step

### Takeaway
Three tables (`document`, `document_preferences`, `document_style_profile`) plus `user_preferences`. `resolveDocumentContext` is one transaction of three upserts. Profiles are written only by `update-profile` (always, on success) and `process-feedback` (only on `updated`).

### Cited Findings
- `document`: `id uuid pk`, `user_id text fk→user cascade`, `external_document_key uuid`, `title text null`, `created_at/updated_at/last_used_at timestamptz default now`, UNIQUE(user_id, external_document_key) — [B/infrastructure/persistence/schema/document.schemas.ts:14-39]
- `document_preferences`: `id`, `document_id uuid UNIQUE fk cascade`, `default_genre text` CHECK in 4 genres, `processing_config jsonb` CHECK object, timestamps — [same file:41-70]
- `document_style_profile`: `id`, `document_id uuid UNIQUE fk cascade`, `profile_markdown text not null`, timestamps — [same file:72-85]
- `user_preferences`: `id`, `user_id text UNIQUE fk`, `correction_instructions text not null default ''` CHECK `char_length ≤ 4000`, timestamps — [B/infrastructure/persistence/schema/user-preferences.schemas.ts:14-38], [B/domain/user-preferences/user-preferences.constants.ts:2]
- `resolveDocumentContext` (single transaction): (1) INSERT document `{userId, externalDocumentKey, title, lastUsedAt: now}` ON CONFLICT (user_id, external_document_key) DO UPDATE `{title only if provided, lastUsedAt: now, updatedAt: now}`; (2) INSERT preferences `{defaultGenre ?? "general", processingConfig ?? DEFAULT}` ON CONFLICT (document_id) DO UPDATE `{defaultGenre if provided, processingConfig if provided, updatedAt}`; (3) INSERT style profile with `INITIAL_DOCUMENT_STYLE_PROFILE_TEMPLATE` ON CONFLICT DO NOTHING, then fallback SELECT; (4) reload document by (userId, key) — [B/infrastructure/persistence/repositories/document.repository.ts:32-143]
- `updateDocumentStyleProfile({documentStyleProfileId, profileMarkdown})`: UPDATE by id, sets `updatedAt`, throws `"Document style profile could not be updated."` if no row — [same file:146-162]
- Per step: stylistic `load-author-profile` → resolve (writes document/preferences/profile); `preference-guided-correction` → read `user_preferences`; `correct-text` → none; `update-profile` → UPDATE style profile; feedback `load-author-profile` → resolve (no genre/config/title, so only `last_used_at`/`updated_at` change); `process-feedback` → UPDATE style profile if `updated` — [B/mastra/workflows/stylistic/steps/load-author-profile/load-author-profile.step.ts:48-55], [B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.step.ts:41-44], [B/mastra/workflows/stylistic/steps/update-profile/update-profile.step.ts:64-67], [B/mastra/workflows/feedback/steps/load-author-profile/load-author-profile.step.ts:48-52], [B/mastra/workflows/feedback/steps/process-feedback/process-feedback.step.ts:95-107]
- Out-of-workflow HTTP routes touch the same tables: `POST /documents/resolve` (requiresAuth), `GET`/`PUT /user/preferences` — [B/server/routes/document.routes.ts:35-38], [B/server/routes/user-preferences.routes.ts:38-39,116-117]
- Upsert of user preferences trims and stores `""` when absent — [B/infrastructure/persistence/repositories/user-preferences.repository.ts:38-70]

### Inferences
- In SQLite, all of this maps to `INSERT … ON CONFLICT(…) DO UPDATE/DO NOTHING … RETURNING` (SQLite ≥3.35) inside one transaction. Replace the CHECKs with equivalents (`json_type(processing_config)='object'`, `length(...) <= 4000`).
- Concurrency: chunks of one document run in parallel and each one's update-profile overwrites the whole profile markdown read at step 1 (last writer wins, lost updates). Parity reproduces that race; a single-process hub could serialise per document.

### Gaps
- `persistenceDb` (B/infrastructure/persistence/db.ts) and the drizzle migrations were not read; there may be extra indexes or triggers.

## 5. Run lifecycle the add-in relies on

### Takeaway
The add-in uses only `getWorkflow(id).details()`, `createRun()` → `runId`, `run.start({inputData})`, `runById(runId, {fields:["result","error"], withNestedWorkflows:false})`, and `createRun({runId}).cancel()`. It polls round-robin every 1 s, retries submit/poll transport failures with exponential backoff (3 retries, base 1 s), and fires feedback without awaiting the outcome.

### Cited Findings
- Ids: `WORKFLOW_ID = "stylistic-workflow"`, `FEEDBACK_WORKFLOW_ID = "feedback-workflow"`, base URL `http://localhost:4111`, `MAX_RETRIES = 3`, `RETRY_BASE_DELAY_MS = 1000`, `POLL_INTERVAL_MS = 1000`, `DEFAULT_MAX_CHUNK_SIZE = 100_000` chars — [A/infrastructure/config.ts:18,36,39,53,71,74,77]
- Client is rebuilt per call with `Authorization: Bearer <token>` — [A/adapters/mastra/MastraClientFactory.ts:16-22], [A/taskpane/taskpane.ts:93-100]
- Health check: `workflow.details()`; any throw → `false` — [A/adapters/mastra/MastraAdapter.ts:51-71]
- Submit: `createRun()`; missing `runId` → error `"Workflow createRun did not return a valid runId"`; then `run.start({inputData: {text, ...input}})` — [A/adapters/mastra/MastraAdapter.ts:78-121]
- The handler submits only `{documentUuid, genero: ctx.genero}` per chunk, so `title` and `processingConfig` are never sent from analysis — [A/domain/pipeline/handlers/AnalyzeChunksHandler.ts:114-117]
- Chunks are submitted sequentially, then polled round-robin until none are pending, with a `pollIntervalMs` delay between passes; cancellation is checked between operations — [A/domain/pipeline/handlers/AnalyzeChunksHandler.ts:83-178]
- Status handling: `success` → validate result; `suspended`/`paused` → failed `"…requires resume(), which this frontend does not support"`; `running`/`pending`/`waiting` → keep polling; terminal `success|failed|tripwire|canceled|bailed` → error from `state.error`; unknown → `"Unknown workflow status: …"`; missing status → `"Invalid workflow poll payload: missing status"` — [A/adapters/mastra/MastraAdapter.ts:127-219], [A/adapters/mastra/MastraAdapter.helpers.ts:23-39]
- Success validation: `result.suggestions` must be an array, and EVERY suggestion needs non-empty trimmed `context`, `anchor`, `justification`, `category`, severity ∈ {high, medium, low}, `context.includes(anchor)`, optional `type` ∈ {track-change, comment-only} (default track-change), and a string `suggestedText` for track-change; optional `warnings: string[]`. Any failure → `retryable-failure` `"Workflow completed but the success payload is not readable yet"` — [A/adapters/mastra/MastraAdapter.ts:157-166,268-294,394-431]
- Mapping assigns ids `chunk{chunkIndex}-{i}` and ignores `cleanPatterns` — [A/adapters/mastra/MastraAdapter.ts:248-266]
- Error text: `Error.message` → string → `obj.message` → `JSON.stringify(obj)`; fallback `Workflow terminated with status "…" without an error payload` — [A/adapters/mastra/MastraAdapter.ts:342-465]
- Cancel: `createRun({runId}).cancel()` → `{canceled: true}` or the error — [A/adapters/mastra/MastraAdapter.ts:222-240]
- Retry decorator: submit retried up to 3 times while no runId; poll retried only on thrown errors; delay `base * 2^(attempt-1)`; stops early on 4xx except 408/429 (reads `error.status`); exhaustion → `"Chunk N: …"` / `retryable-failure` — [A/adapters/RetryAnalysisDecorator.ts:58-207]
- User-facing abort messages: retryable runs → `"La consulta del análisis falló localmente. Reintentá la consulta con el mismo run."`; cancelled → `"Análisis cancelado por el usuario."`; errors → `"El análisis falló en N fragmento(s). Intenta de nuevo."`; none → `"No se encontraron sugerencias editoriales."`. Abort happens only when there are zero suggestions in total (partial success otherwise) — [A/domain/pipeline/handlers/AnalyzeChunksHandler.ts:256-283]
- Feedback: sent only for `accepted`/`rejected` results; payload `{documentUuid, category, context, anchor, suggestedText?, justification, action, severity, suggestionType, comment? (trimmed, omitted if empty)}`; `createRun()` + `run.start({inputData})`; all errors swallowed; not polled — [A/domain/suggestion/SuggestionResolutionWorkflow.ts:72-125], [A/adapters/mastra/FeedbackAdapter.ts:28-48]
- No `warnings` field is produced by the backend output schemas — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.schemas.ts:90-101]

### Inferences
- The backend must run workflows asynchronously and keep run state queryable by runId (status/result/error). That is the only "snapshot persistence" the client needs; resume/suspend is never used.
- A replica can expose the same HTTP shape (so the client keeps working) or replace `@mastra/client-js` with an IPC port. In both cases the statuses actually emitted are `running`, `success`, `failed` and `canceled`.
- One malformed suggestion (anchor not in context) makes the whole chunk unreadable on the client. The backend could filter instead, but that would be a behaviour change, not parity.

### Gaps
- I did not verify whether `@mastra/client-js` `run.start` resolves on start or on completion (Mastra-internal). FeedbackAdapter's comment implies fire-and-forget.
- I did not check where `ctx.chunkErrors` text is rendered in the UI.

## 6. Scorers

### Takeaway
Three LLM-judge scorers run at 100% sampling (ratio 1) on every stylistic correction. They are pure observability (results go to Mastra storage) and do not change outputs, so they are not needed for functional parity.

### Cited Findings
- `instructionCompliance` (`stylistic-instruction-compliance-scorer`, type "agent", judge `evalModelPool.standard`): checks whether the agent respected explicit user intervention limits in the prompt. Attached to stylisticAgent with `sampling {type:"ratio", rate:1}`, so it runs on both stylistic LLM calls — [B/mastra/agents/stylistic-agent/scores/instruction-compliance/instruction-compliance.scorer.ts:18-31], [B/mastra/agents/stylistic-agent.ts:16-24]
- `falsePositiveSuppression` (penalises invented/weak findings, false lexical echoes) and `voicePreservation` (penalises erased register/flattened tone), both attached to step `correct-text` at rate 1 — [B/mastra/workflows/stylistic/steps/correct-text/scores/false-positive-suppression/false-positive-suppression.scorer.ts:17-30], [B/mastra/workflows/stylistic/steps/correct-text/scores/voice-preservation/voice-preservation.scorer.ts:18-31], [B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.ts:33-48]
- Judge model for all tiers: `opencode-go/deepseek-v4-flash` (not wrapped by withCodexBackend) — [B/mastra/constants/models.ts:55-59]
- Default storage is Postgres "for memory, workflows, scores" — [B/mastra/constants/storage.ts:5-11]

### Inferences
- Each stylistic run currently costs up to 2 (stylistic) + 1 (profile) + 4 judge LLM calls (2 instructionCompliance + 2 correct-text scorers). Dropping scorers cuts latency and cost without changing user-visible output. They are optional for an offline eval harness.

### Gaps
- I did not verify whether scorers run async after the step or block it (Mastra-internal).

## 7. Implicit Mastra features and feature matrix

### Takeaway
Beyond `createWorkflow/createStep` + `Agent.generate(structuredOutput)`, the workflows depend on the Mastra-provided authenticated `requestContext.get("user")`, `mastra.getAgent()`, async run storage/polling, cancel, and model fallback/retries. Memory, vectors, workspace, tracing, OpenAPI and scorers are wired but not functionally needed.

### Cited Findings
- `requestContext.get("user")?.user.id` (Better Auth session object) is the only identity source in the workflow steps — [B/mastra/workflows/stylistic/steps/load-author-profile/load-author-profile.step.ts:16-21], [B/auth/mastra-auth.ts:42-58]
- Agents carry `memory` (Postgres + PgVector + Ollama `qwen3-embedding:0.6b`, lastMessages 10, semanticRecall topK 3) — [B/mastra/constants/memory.ts:6-17], [B/mastra/agents/stylistic-agent.ts:25], [B/mastra/agents/document-profile-agent.ts:14], [B/mastra/agents/document-feedback-agent.ts:14]
- No step passes memory thread/resource options to `generate` — [B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.ts:110], [B/mastra/workflows/stylistic/steps/update-profile/update-profile.step.ts:48-52], [B/mastra/workflows/feedback/steps/process-feedback/process-feedback.step.ts:81-85]
- Mastra instance: 3 workflows, 5 agents, composite storage (Postgres default + DuckDB observability), pgVector, auth, custom routes, PinoLogger, Observability (DefaultExporter + CloudExporter + SensitiveDataFilter) — [B/mastra/index.ts:192-298]
- Workspace (LocalFilesystem/Sandbox) is defined but no workflow agent references it — [B/mastra/constants/workspaces.ts:55-61], [B/mastra/agents/document-profile-agent.ts:9-15]
- Custom routes declare `openapi` metadata — [B/server/routes/document.routes.ts:38-45]

**Feature matrix**

| Mastra feature | Used where | Must replicate? | Notes |
| --- | --- | --- | --- |
| `createWorkflow` linear `.then` chain + `commit` | stylistic-workflow.ts:17-27; feedback-workflow.ts:13-21 | yes | A plain async function pipeline is enough; no branches/parallel/loops. |
| Step input/output zod validation | every `createStep` | yes (cheap) | Reuse the same zod schemas at step boundaries; strict suggestion schemas matter. |
| Workflow input defaults (`genero` default "general") | load-author-profile.schemas.ts:17-20 | yes | Affects the preferences overwrite. |
| Async runs: `createRun`/`start`/`runById(status,result,error)` | MastraAdapter.ts:97-138 | yes | In-memory or SQLite `runs` table; statuses running/success/failed/canceled. |
| Run cancel (`createRun({runId}).cancel()`) | MastraAdapter.ts:228-230 | yes | Abort controller per run; mark `canceled`. |
| Workflow `details()` health check | MastraAdapter.ts:63-64 | yes (or replace) | Any 2xx "exists" endpoint, or an IPC ping. |
| Suspend/resume, snapshots | not used (client rejects suspended/paused) | no | MastraAdapter.ts:179-188. |
| `mastra.getAgent(id)` registry | correct-text.step.ts:59; update-profile.step.ts:26; process-feedback.step.ts:55 | yes (trivial) | Keep the "agent not found" error messages if tests assert them. |
| `Agent.generate` + `structuredOutput` zod | 4 LLM steps | yes | Pi must return JSON validated by the same schemas; "no structured output" errors. |
| `modelSettings.temperature: 0` | correct-text.helpers.ts:213 | optional | Ignored by the default Codex-direct backend (protocol.ts:99-110). |
| Google `providerOptions` (thinking high, safety BLOCK_NONE) for narrativa-literaria | correct-text.helpers.ts:195-207 | only if Gemini is used | Same caveat. |
| Model array fallback + `maxRetries: 3` | models.ts:5-36 | optional | Active only with `MODEL_BACKEND=metered`. |
| `withCodexBackend` / Codex-direct custom LanguageModel | models.ts:43-49; selector.ts:38-56 | no (replaced by Pi provider) | Default backend today; decide on the Pi equivalent. |
| Safety-block error translation | correct-text.helpers.ts:110-126 | optional | Only meaningful for Gemini errors. |
| requestContext `user` from Better Auth | load-author-profile.step.ts:16-21; preference step :24-29 | yes (as a constant) | Single local user → fixed userId; keep the FK shape. |
| Memory (PG + vector + Ollama embedder) | agents' `memory` | no | No thread/resource passed, so (inference) no recall is used. |
| Vectors (pgVector) | index.ts:206-208 | no | Only backs memory. |
| Scorers (3 LLM judges, rate 1) | stylistic-agent.ts:16-24; correct-text.step.ts:33-48 | no / optional | Observability only; offline eval later. |
| Observability/tracing (DuckDB, Cloud exporter) | index.ts:284-297; storage.ts:9 | no | Replace with local logs. |
| PinoLogger + `shared/logger` | all steps | optional | Log messages are not a contract. |
| Workspace (filesystem/sandbox) | workspaces.ts | no | Not attached to workflow agents. |
| Server auth (MastraAuthBetterAuth), `/auth*` routes | index.ts:209-279; mastra-auth.ts | no | Single local user. |
| Custom API routes `/documents/resolve`, `/user/preferences` | document.routes.ts; user-preferences.routes.ts | yes (functionally) | Needed for the preferences that feed step 2. |
| OpenAPI metadata | document.routes.ts:38+ | no | Docs only. |
| Workflow storage in Postgres (`PostgresStore`) | storage.ts:7; db.ts | partial | Only run state for polling. |

### Inferences
- Memory is attached but likely inert: Mastra memory needs a thread/resource to read or write, and none is passed. This is unverified Mastra-internal behaviour (see Gaps).

### Gaps
- Unverified: whether Mastra memory with no `memory.thread/resource` option is a no-op, and whether Mastra auto-retries failed steps (no `retryConfig` appears in these workflows).
- The add-in may call other Mastra endpoints elsewhere (I searched only for `createRun|runById|workflow ids`; matches were limited to these two adapters and config).

## 8. Existing tests usable as parity tests

### Takeaway
Backend: 8 step-level test files (39 tests). Add-in: 7 test files covering the adapter, decorator, handler and feedback flow. There is no end-to-end workflow test.

### Cited Findings
- `B/mastra/workflows/stylistic/steps/correct-text/correct-text.helpers.test.ts` (11 tests: normalisation downgrade rules)
- `B/mastra/workflows/stylistic/steps/correct-text/correct-text.prompt.test.ts` (5: profile embedding, no-profile text, `<correcion-previa>`, typography transports)
- `B/mastra/workflows/stylistic/steps/correct-text/correct-text.schemas.test.ts` (8: track-change/comment-only strictness)
- `B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.test.ts` (7: normalised output, agent missing, Google safety wrap, transport failure propagation, no structured output)
- `B/mastra/workflows/stylistic/steps/preference-guided-correction/preference-guided-correction.step.test.ts` (3: pass-through null, stored previousCorrection, normalisation)
- `B/mastra/workflows/stylistic/steps/update-profile/update-profile.step.test.ts` (2: persists profile, missing agent)
- `B/mastra/workflows/feedback/steps/process-feedback/process-feedback.step.test.ts` (2: persists on feedback, empty comment skips agent)
- `B/domain/documents/document.constants.test.ts` (1: canonical PATRONES VIVOS skeleton)
- Add-in: `A/adapters/mastra/__tests__/MastraAdapter.test.ts`, `A/adapters/mastra/__tests__/FeedbackAdapter.test.ts`, `A/adapters/__tests__/RetryAnalysisDecorator.test.ts`, `A/domain/pipeline/handlers/__tests__/AnalyzeChunksHandler.test.ts`, `A/domain/suggestion/__tests__/SuggestionResolutionWorkflow.test.ts`, `A/domain/suggestion/__tests__/SuggestionResolutionWorkflowTerminalFeedback.test.ts`, `A/taskpane/__tests__/TaskpaneFeedback.test.ts`

### Inferences
- The prompt, helper and schema tests are pure functions and can be ported almost verbatim as golden tests. The step tests mock the agent and repository and map to Pi-agent fakes. Missing tests worth adding for parity: the word-count helper (no test file found), `resolveDocumentContext` upsert semantics, the update-profile zone thresholds (550/800), and an end-to-end run lifecycle (start → poll → success/failed/canceled).

### Gaps
- I did not read the test bodies, only titles (via grep). No repository or route tests exist under `B/` for these paths (the find returned none).
