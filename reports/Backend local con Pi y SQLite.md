# Reescribir Stylistic sobre Pi sin Mastra

**Recomendación:** reescribir el backend como un **orquestador propio, tipado y pequeño** (unas 200–400 líneas, estimación no medida) que corre en un `utilityProcess` del Stylistic Hub. El orquestador llama a `@earendil-works/pi-ai` directamente, sin `createAgentSession`, y guarda todo en **un único archivo SQLite abierto con `node:sqlite`**. Las cuentas de usuario y Better Auth se eliminan por completo. En su lugar quedan **un token secreto por instalación y guardas de loopback/Host/Origin**. Mastra ya no aporta nada que estos dos workflows necesiten: son cadenas lineales de 4 y 2 pasos, sin ramas del DSL, sin suspend/resume, y con memoria y vectores que muy probablemente están inertes. Pi, por su parte, no ofrece un motor de workflows estable, ni `structuredOutput`, ni fallback entre modelos. Por eso, lo que hay que construir encima de Pi está acotado: un runner con tabla `workflow_run` (estado, polling, cancelación), un envoltorio de salida estructurada basado en una herramienta forzada y validada, pools de modelos con reintentos, y la inyección de `safetySettings` de Google mediante `onPayload`. La investigación desmiente varias premisas de partida. El backend por defecto actual no es Gemini sino **Codex-direct (`gpt-5.6-sol`)**, que ya ignora `temperature` y las opciones de Google. **Anthropic prohíbe el login de suscripción Claude.ai en aplicaciones de terceros.** **Pi eliminó el OAuth de Gemini CLI.** `pi-durable` es experimental. Drizzle solo admite `node:sqlite` en la línea 1.0 rc. El riesgo principal ya no es técnico sino de verificación: hay que demostrar con spikes la salida estructurada estricta por proveedor y la paridad byte a byte de los prompts antes de retirar Mastra.

Leyenda de citas locales: `B/` = `D:\dev\eln\stylistic\stylistics-backend\src\`, `A/` = `D:\dev\eln\stylistic\stylistic-addon\src\`. Las citas web enlazan a la fuente primaria cuando existe. Las afirmaciones marcadas **[NO VERIFICADO]** proceden de fuentes secundarias, de inferencias o de conocimiento previo, y requieren comprobación.

## Quince hallazgos que corrigen las premisas iniciales

Antes del análisis conviene separar lo que la investigación cambió respecto de lo que se suponía. Varios de estos hallazgos alteran directamente la definición de "paridad exacta".

| # | Premisa previa | Hallazgo | Evidencia |
|---|---|---|---|
| 1 | Los agentes corren sobre Gemini/OpenAI con `temperature: 0`, thinking alto y safety `BLOCK_NONE` | Con `MODEL_BACKEND` sin definir, **todos los agentes van a Codex-direct (`gpt-5.6-sol`, `https://chatgpt.com/backend-api/codex/responses`)**. El cuerpo de la petición no incluye `temperature` ni `providerOptions`. Los pools Gemini/OpenAI con `maxRetries: 3` solo aplican con `MODEL_BACKEND=metered` | `B/mastra/agents/codex-subscription/codex-subscription.selector.ts:38-56`; `B/mastra/agents/codex-direct/codex-direct.constants.ts:18-25`; `B/mastra/agents/codex-direct/codex-direct.protocol.ts:75-110` |
| 2 | Se podría usar la suscripción Claude Pro/Max vía OAuth de Pi | Anthropic: "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials" | ([Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)) |
| 3 | Gemini podría usarse con login de suscripción | Pi eliminó el soporte integrado de Google Gemini CLI y Antigravity. Google solo es accesible con `GEMINI_API_KEY` o Vertex | `pi-coding-agent/CHANGELOG.md:2044,2094` (instalación local 1.0.2) |
| 4 | Pi trae orquestación de workflows | Los paquetes estables no tienen DSL de workflows. `@earendil-works/pi-durable` existe, pero "The API changes without notice between releases" y no está en ninguna instalación local | ([GitHub packages/durable](https://github.com/earendil-works/pi/tree/main/packages/durable)) |
| 5 | SQLite en Electron implica módulos nativos | `node:sqlite` ya funciona en un `utilityProcess` de Electron 44 en el proyecto hermano dhub | `D:\dev\disble\d-hub\dhub\src\main\adapters\sqlite-storage.ts:176-178`; `src/main/engine-host.ts:19` |
| 6 | Drizzle se mantiene con cambio de driver | `drizzle-orm@0.45.2` instalado no trae `node-sqlite`. El driver solo está documentado con `drizzle-orm@rc` | ([Drizzle node-sqlite](https://orm.drizzle.team/docs/connect-node-sqlite)) |
| 7 | Pi sustituye `structuredOutput(zod)` de forma directa | pi-ai no tiene `responseFormat` ni `structuredOutput`. El patrón es una herramienta forzada con esquema TypeBox, `constrainedSampling` estricto y `validateToolCall()` | `pi-ai/README.md:541-557,667-700`; `pi-ai/dist/types.d.ts:23` |
| 8 | Pi gestiona fallback entre modelos | No existe fallback de cliente entre proveedores. Solo hay fallbacks del lado servidor de Anthropic y OpenRouter | `pi-ai/dist/types.d.ts:239-243,796` |
| 9 | Las opciones de Google se pasan igual | `GoogleOptions` solo modela `toolChoice` y `thinking`. No hay `safetySettings`; la única vía es `onPayload` | `pi-ai/dist/api/google-generative-ai.d.ts:1-10` |
| 10 | Hace falta vector search (pgvector) | pgvector solo respalda Mastra Memory, y ningún paso pasa `threadId`/`resourceId`. La memoria muy probablemente está inerte **[NO VERIFICADO en runtime]** | `B/mastra/constants/memory.ts:6-17`; grep sin coincidencias de `threadId\|resourceId` |
| 11 | Los scorers forman parte del workflow | Son 3 jueces LLM al 100 % de muestreo, solo de observabilidad, y añaden hasta 4 llamadas por ejecución | `B/mastra/agents/stylistic-agent.ts:16-24`; `B/mastra/workflows/stylistic/steps/correct-text/correct-text.step.ts:33-48` |
| 12 | El perfil se actualiza de forma segura | El paso 4 es bloqueante: si falla, el usuario no recibe sugerencias. Los chunks en paralelo se pisan el perfil (gana el último escritor) | `B/mastra/workflows/stylistic/steps/update-profile/update-profile.step.ts:19-85`; `A/domain/pipeline/handlers/AnalyzeChunksHandler.ts:83-178` |
| 13 | El motor de dhub se puede copiar tal cual | dhub no tiene petición de cancelación ni estado "en curso": persiste las ejecuciones solo al terminar | `dhub/src/main/engine/protocol.ts:163-284`; `src/main/domain/engine.ts:166-330` |
| 14 | Sin usuarios, el API local puede ir sin autenticación | Local Network Access de Chrome no controla las peticiones localhost→localhost y cualquier proceso local alcanza loopback. **El token sigue siendo necesario** | ([Chrome LNA](https://developer.chrome.com/blog/local-network-access)) |
| 15 | Pi es una dependencia estable | Hubo unas 20 versiones entre 0.82.0 (2026-07-24) y 1.0.2 (2026-10-04), con cambios incompatibles en varias minor. La 1.0.1 dejó de publicar shrinkwrap | `pi-coding-agent/CHANGELOG.md:53-55,272,334,533,706` |

El hallazgo 1 es el más importante para la paridad. La "referencia" que hay que replicar es Codex-direct sin temperatura ni safety, no Gemini con thinking alto. En la práctica las opciones de Google son código que solo se activa en modo `metered`.

## A. Un orquestador propio sobre pi-ai replica ambos workflows con menos peso que Mastra

### Los dos workflows son tuberías lineales con condicionales internos

`stylistic-workflow` es `load-author-profile → preference-guided-correction → correct-text → update-profile`. `feedback-workflow` es `load-author-profile → process-feedback`. Ambos son cadenas `.then()` sin ramas, bucles ni paralelismo del DSL (`B/mastra/workflows/stylistic/stylistic-workflow.ts:17-27`; `B/mastra/workflows/feedback/feedback-workflow.ts:13-21`). La lógica condicional son `return` tempranos dentro de los pasos. El paso 2 no llama al LLM si `correctionInstructions` está vacío. `process-feedback` devuelve `{received: true, receivedAt}` sin LLM si no hay `comment`. En total hay **cinco pasadas LLM posibles con salida estructurada**, y ninguna necesita herramientas. El add-in solo usa `details()`, `createRun()`, `start()`, `runById(fields: result, error)` y `cancel()`. Hace polling cada 1 s, reintenta 3 veces con backoff exponencial y solo interpreta los estados `running`, `success`, `failed` y `canceled`. Rechaza `suspended`/`paused` con un error explícito (`A/adapters/mastra/MastraAdapter.ts:127-219`). Con ese contrato, replicar el workflow consiste en replicar una función asíncrona con estado consultable. No hace falta un motor durable.

### Clasificación de opciones de orquestación

| Rango | Opción | Embebible con SQLite | Polling/cancel listos | Peso y dependencias | Encaje con Pi | Veredicto |
|---|---|---|---|---|---|---|
| 1 | **Pipeline propio tipado + tabla `workflow_run`** | Sí (`node:sqlite`) | Se construyen (tabla + `AbortController`) | Mínimo; TypeBox ya viene con pi-ai | Total; `signal` va directo a pi-ai | **Recomendado** |
| 2 | Mastra standalone + `LibSQLStore` | Sí, pero con `@libsql/client` nativo | Sí, con instancia `Mastra` y storage | `@mastra/core` 1.77.0: unos 76 MB desempaquetado, 30 dependencias, incluye `@ai-sdk/provider` v5/v6/v7, hono y posthog-node ([npm](https://registry.npmjs.org/@mastra/core/latest)) | Pasos llaman a Pi; obliga a mantener zod y TypeBox | Menor riesgo semántico, mayor peso |
| 3 | Effect `SingleRunner` + `SqlMessageStorage` | Sí; "local, embedded, or small single-node setups" ([Effect](https://effect.website/docs/v4/api/effect/unstable/cluster/SingleRunner)) | Durable de verdad | `@effect/workflow` 0.19.1, pre-1.0, transición v3→v4 ([npm](https://registry.npmjs.org/@effect/workflow/latest)) | Agnóstico, pero impone Effect en todo el backend | Solo si se adopta Effect en todo |
| 4 | LangGraph.js + `SqliteSaver` | Sí (better-sqlite3) ([npm](https://registry.npmjs.org/@langchain/langgraph-checkpoint-sqlite/latest)) | No; checkpoints por `thread_id`, sin estado de run | Arrastra `@langchain/core` | Forma equivocada (grafo de agente) | Descartable |
| 5 | `pi-durable` | Sí (`openNodeSqliteStorage`) | Sí (`taskGraph()`, `watch()`, `abort`) | No publicado localmente; **experimental** | Nativo de Pi | Vigilar, no adoptar |
| — | Vercel Workflow, DBOS TS, Inngest, Restate, Temporal, Trigger.dev, Hatchet, BullMQ, Graphile Worker | No: Local World "Not persistent" ([Workflow](https://useworkflow.dev/docs/deploying/world/local-world)); DBOS TS solo Postgres ([DBOS](https://docs.dbos.dev/typescript/reference/configuration)); Inngest/Restate requieren binario servidor ([Inngest](https://www.inngest.com/docs/self-hosting.md), [Restate](https://docs.restate.dev/get_started/quickstart)) | — | — | — | Descartados |
| — | Colas SQLite (liteque, etc.), `p-queue` | Persisten jobs, no workflows multipaso ([liteque](https://npmjs.com/package/liteque)) | No | Ligeros | Complementos | Solo como complemento (`p-queue` para limitar concurrencia) |

Mastra standalone ocupa el segundo puesto porque sería el camino más rápido hacia "la misma semántica". Pero esa ventaja es menor de lo que parece. El cliente solo distingue cuatro estados, que un `runs` propio emite de forma trivial. Además, para tener snapshots y búsqueda de runs, Mastra exige igualmente una instancia `Mastra` con storage ([Mastra snapshots](https://mastra.ai/docs/workflows/snapshots)). Eso introduce `@libsql/client` como un segundo motor SQLite nativo junto a `node:sqlite`. Ninguna de sus ventajas restantes (Studio, time-travel, suspend/resume genérico, combinadores) aparece en estos dos workflows.

### Análisis por bandas de la pregunta A

| Banda | Pipeline propio sobre pi-ai | Mastra standalone | pi-durable |
|---|---|---|---|
| Fidelidad funcional | Total si se copian prompts y esquemas al byte y se portan los tests puros como golden tests | Total en estados; los pasos igualmente se reescriben para llamar a Pi | Alta, pero el modelo de tareas difiere del de pasos |
| Complejidad y dependencias | Unas 200–400 líneas propias (estimación); pi-ai + TypeBox | 76 MB, AI SDK sin uso, libSQL nativo, zod + TypeBox | Paquete no estable, curva de aprendizaje |
| Riesgo y madurez | Riesgo concentrado en el envoltorio de salida estructurada | Bajo en motor, alto en empaquetado Electron | Alto: API cambia sin aviso |
| Operación local | Un proceso, un driver, logs estructurados por paso | Dos motores SQLite en un proceso, contención de bloqueos | Un driver SQLite, checkpoint por paso |
| Reversibilidad | Alta: puertos hexagonales permiten cambiar de motor más tarde | Media | Baja mientras sea experimental |

### Lo que Pi aporta y lo que hay que construir encima

Pi resuelve bien el acceso a modelos. Ofrece colecciones multiproveedor con OAuth, API key y modelos locales; refresco de tokens bajo bloqueo; opciones tipadas (`temperature`, `maxTokens`, `reasoning`/`thinking`, `toolChoice` por proveedor); `signal` para abortar; `retryAssistantCall` para errores transitorios (sin reintentar abortos ni agotamiento de cuota); y uso y coste en cada `AssistantMessage`, incluso en los fallidos (`pi-ai/README.md:107-224,982-1017,1091-1115`; `pi-ai/dist/utils/retry.d.ts:1-47`). Para pasos deterministas, la llamada directa `models.complete()` encaja mejor que `createAgentSession`. Esta última carga `SettingsManager`, recursos (AGENTS.md, skills, extensiones), prompt de sistema propio y herramientas de código, y eso contamina el prompt (`pi-coding-agent/docs/sdk.md:36-106`).

Sobre Pi hay que construir seis piezas:

1. **El runner y su almacén de ejecuciones.** Se puede modelar sobre el `executeAutomation` secuencial de dhub (`dhub/src/main/domain/pipeline.ts:180-234`). A diferencia de dhub, debe escribir la fila `running` al empezar y actualizarla en cada paso.
2. **El registro `runId → AbortController`** para cancelar.
3. **`structuredCall`.** Define una herramienta `submit_*` con esquema TypeBox `additionalProperties: false` y `StringEnum` (no `Type.Enum`, que Google no soporta). La fuerza según `model.api`: Anthropic `{type:'tool', name}`, Google `'any'`, Codex `'required'`. Aplica `constrainedSampling: {type:'json_schema', strict:'prefer'}`, valida con `validateToolCall` y además con los zod actuales. Si la validación falla, vuelve a preguntar un máximo de N veces.
4. **`runWithPool`**, que recorre modelos en orden con `retryAssistantCall` y deja `maxRetries` del proveedor en 0, como aconseja la documentación de Pi (`pi-coding-agent/docs/settings.md:125-133`).
5. **La inyección de `safetySettings` vía `onPayload`** para `narrativa-literaria` cuando el proveedor es Google. La forma exacta del payload está **[NO VERIFICADA]**.
6. **Un directorio de agente propio de la app** (`PI_CODING_AGENT_DIR` o `agentDir`), siguiendo el precedente de dhub.

### Matriz de paridad Mastra → nuevo stack

| Funcionalidad Mastra | Dónde se usa | ¿Replicar? | Cómo en el nuevo stack |
|---|---|---|---|
| `createWorkflow` lineal `.then()` + `commit()` | `stylistic-workflow.ts:17-27`; `feedback-workflow.ts:13-21` | Sí | Funciones asíncronas encadenadas en un runner; ids de paso idénticos (`load-author-profile`, `preference-guided-correction`, `correct-text`, `update-profile`, `process-feedback`) |
| Validación zod de entrada/salida por paso | Cada `createStep` | Sí | Reutilizar los mismos esquemas zod 4 en las fronteras de paso; TypeBox solo para la herramienta de salida del LLM |
| Default `genero = "general"` | `load-author-profile.schemas.ts:17-20` | Sí | Mismo default; mantiene la sobrescritura de `default_genre` en cada ejecución |
| `createRun`/`start`/`runById` asíncrono | `MastraAdapter.ts:97-138` | Sí | `POST /runs` devuelve `runId` y ejecuta en segundo plano; `GET /runs/:id` lee `workflow_run` |
| `cancel()` | `MastraAdapter.ts:222-240` | Sí | `AbortController` por run, pasado como `signal` a pi-ai; estado `canceled` |
| `details()` (health) | `MastraAdapter.ts:51-71` | Sí (sustituible) | `GET /health` |
| Suspend/resume, snapshots | No usado; el cliente los rechaza | No | — |
| `mastra.getAgent(id)` | `correct-text.step.ts:59` y otros | Sí (trivial) | Registro de "agentes" (prompt de sistema + pool); conservar los mensajes "agent not found" que asertan los tests |
| `Agent.generate` + `structuredOutput` | 4 pasos LLM | Sí | `structuredCall` con herramienta forzada + validación; mismos errores ("No output structured received from …") |
| `temperature: 0` | `correct-text.helpers.ts:213` | Opcional | Pasar `temperature: 0` donde el modelo lo admita; el backend Codex por defecto ya lo ignora |
| `providerOptions.google` (thinking high, safety `BLOCK_NONE`) | `correct-text.helpers.ts:190-218` | Solo si se usa Gemini | `thinking: {enabled, level}` + `onPayload` para `safetySettings` **[forma NO VERIFICADA]** |
| Pools de modelos + `maxRetries: 3` | `B/mastra/constants/models.ts:5-49` | Opcional (solo modo `metered`) | `runWithPool` + `retryAssistantCall({maxRetries: 3})` |
| `withCodexBackend` / Codex-direct | `codex-subscription.selector.ts:38-56` | Sustituir | Proveedor Pi "OpenAI Codex" / "Sign in with ChatGPT" **[disponibilidad de `gpt-5.6-sol` en el catálogo de Pi NO VERIFICADA]** |
| Traducción de bloqueo de safety de Gemini | `correct-text.helpers.ts:22-126` | Opcional | Mapear `stopReason: 'error'` + mensaje al mismo texto "Google/Gemini blocked …" **[cómo aflora SAFETY en Pi NO VERIFICADO]** |
| Normalización de sugerencias (downgrade a `comment-only`) | `correct-text.helpers.ts:132-184` | Sí | Copiar las funciones tal cual, con sus 11 tests |
| Conteo de palabras de `## PATRONES VIVOS` y zonas 550/800 | `load-author-profile.helpers.ts:6-45`; `update-profile.helpers.ts:3-30` | Sí | Copiar la regex exacta. Ojo: `^##\s+` no corta en `###`, así que una plantilla vacía cuenta 6 palabras |
| `requestContext.get("user")` | `load-author-profile.step.ts:16-21` | Sí, como constante | `RequestPrincipal` fijo del hub; desaparece el error "Authenticated user is required…" o se reduce a un invariante |
| Memory (PG + pgvector + embedder Ollama) | Agentes | No | Eliminar; no se pasan thread ni resource |
| Scorers (3 jueces LLM) | `stylistic-agent.ts:16-24` | No (opcional offline) | Harness de evaluación fuera de línea sobre la tabla de runs |
| Observabilidad (DuckDB, CloudExporter) | `B/mastra/index.ts:284-297` | No | Logs estructurados por paso + `steps_json` con uso y coste |
| Auth Better Auth y rutas `/auth*` | `B/mastra/index.ts:209-279` | No | Token del hub (sección B) |
| Rutas `/documents/resolve`, `/user/preferences` | `document.routes.ts`; `user-preferences.routes.ts` | Sí (funcionalmente) | `POST /documents/resolve`, `GET/PUT /preferences` sobre el singleton `hub` |
| Storage de workflows en Postgres | `B/mastra/constants/storage.ts:7` | Parcial | Solo `workflow_run` en SQLite |

La paridad de prompts merece su propia regla. Todos los prompts son plantillas XML en español: introducción por género, `SUGGESTION_TYPES_SECTION`, `<perfil-autor>`, y las *skills* `PROFILE_AGENT_SKILL` y `FEEDBACK_AGENT_SKILL` como constantes de 8,5 KB. No son skills de workspace de Mastra (`B/mastra/agents/profile-agent.skill.ts:2-190`; `B/mastra/agents/feedback-agent.skill.ts:49-125`). Lo más barato es copiar los `.prompt.ts`, `.skill.ts` y `*.constants.ts` al byte, y portar como golden tests los 39 tests de paso existentes. Faltan tests que conviene añadir antes de migrar: el conteo de palabras, la semántica de upsert de `resolveDocumentContext`, los umbrales 550/800 y un test de extremo a extremo del ciclo start → poll → success/failed/canceled.

Hay dos comportamientos que la paridad estricta obliga a conservar aunque sean discutibles. El primero es que un fallo del agente de perfil en el paso 4 hace fallar toda la ejecución. El segundo es que los chunks en paralelo se pisan el perfil. Como el hub tiene un solo proceso, serializar `update-profile` por documento sería una mejora trivial, pero eso es una **decisión de producto**, no paridad.

## B. Sin usuarios, el token del hub sustituye a la sesión, no a la autenticación

### Tres "sesiones" con destinos distintos

La frase "eliminar sesiones" mezcla tres conceptos, y separarlos reduce mucho el riesgo percibido.

| Concepto | Hoy | ¿Sobrevive? | Nuevo nombre y forma |
|---|---|---|---|
| Sesión de autenticación (Better Auth) | Token bearer de 30 días ligado a una fila `user`; tablas `user`, `session`, `account`, `verification`; puente de diálogo de Office (`/auth-complete`, `/auth-bridge-session`) (`B/auth/auth.ts:36,53`; `B/mastra/index.ts:219,255`) | **No** | Desaparece. La sustituye el **token del hub**, sin ciclo de vida ni refresh |
| Sesión de agente Pi (`SessionManager`) | No existe en Stylistic | Sí, como detalle interno | **Conversación de agente**. Con llamadas directas a pi-ai no se crea ninguna. Si en el futuro hay chat persistente, JSONL en `userData/pi/sessions/<document-uuid>/` |
| Ejecución de workflow (run de Mastra) | Snapshot en Postgres consultado por `runId` | Sí | **Workflow run**: fila en `workflow_run` asociada al documento, sin usuario |

El precedente local confirma los dos últimos usos de Pi. dhub usa `SessionManager.inMemory` para ejecuciones headless y `create`/`open` para conversaciones (`dhub/src/main/adapters/pi-session.ts:199-202`). course-platform guarda conversaciones reanudables como JSONL (`D:\Método PEN\course-platform\server\assistant\session.ts:181-183`). Con la recomendación de la sección A (pi-ai directo), Stylistic no produce ningún JSONL. Todo el historial vive en SQLite.

### Diseño de seguridad del API local

Un API HTTP en loopback sin autenticación queda al alcance de cualquier página web visitada, de ataques de DNS rebinding y de cualquier proceso local. Local Network Access de Chromium ayuda: desde Chrome 142 pide permiso para peticiones de sitios públicos a loopback. Pero no controla localhost→localhost, y el usuario puede pulsar "Permitir" ([Chrome LNA](https://developer.chrome.com/blog/local-network-access)). Edge activa LNA por defecto desde la 144 ([Microsoft Edge policy](https://learn.microsoft.com/en-my/deployEdge/microsoft-edge-policies/localnetworkaccessrestrictionsenabled)). Que Chrome 156 elimine la exclusión empresarial temporal procede de una fuente secundaria y está **[NO VERIFICADO]**. La defensa debe tener capas:

| Capa | Control | Amenaza mitigada |
|---|---|---|
| Red | Escuchar solo en `127.0.0.1`, nunca en `0.0.0.0` | Acceso desde la LAN |
| Peer | Comprobar que el peer del socket es loopback (127/8, `::1`, `::ffff:127.x`), leído del socket y nunca de `X-Forwarded-For`; fallo cerrado | Proxies y cabeceras falsificadas |
| Host | `Host` ∈ {`localhost:<puerto>`, `127.0.0.1:<puerto>`, `[::1]:<puerto>`} en cada petición. Precedente: course-platform, "A rebinding attack reaches the loopback socket under an attacker's hostname, so this refuses it" (`course-platform/server/app.ts:~141-182`) | DNS rebinding |
| Origin | Coincidencia exacta con `https://localhost:3000` en peticiones que cambian estado; preflight CORS solo para ese origen. Desaparece si API y task pane comparten origen | Páginas web drive-by |
| Token | `Authorization: Bearer <token>` de 256 bits aleatorio, guardado en `userData` (ACL de Windows por usuario), comparado en tiempo constante y rotable. Al ser una cabecera no simple, obliga a preflight | Páginas web, CSRF y **otros procesos/usuarios locales** |
| Superficie | Borrar `/auth-complete`, `/auth-bridge-session` y `OfficeDialogAuthAdapter` | CSRF del puente de diálogo |

Las páginas web no pueden leer `localStorage` ni el `userData` de otro origen, pero un proceso local puede falsificar `Origin`. Por eso importa cómo recibe el task pane el token. Se recomienda que **el hub sirva el propio task pane** en `https://localhost:3000` e inyecte el token en el HTML (por ejemplo, en un `<meta>`) al servirlo. El token nunca pasa por un endpoint consultable y el hub ya es dueño de ese origen. Servir también el API bajo el mismo origen (`https://localhost:3000/api/...`) elimina CORS por completo. Las alternativas son peores. Un endpoint `GET /hub/pairing` filtrado por Origin solo protege frente a navegadores. Un parámetro en el manifiesto queda descartado porque el manifiesto es estático y compartido. Los `Settings` del documento quedan descartados porque viajan dentro del `.docx` y filtrarían el token al compartir el archivo. Como respaldo queda un código de emparejamiento visible en la ventana del hub. La clave de `localStorage` `stylistic.auth.session.v1` pasa a ser `stylistic.hub.token.v1`, y la antigua se borra en el primer arranque.

### Office, varios usuarios de Windows y varios PCs

Word en Windows aloja el task pane en Edge WebView2. Su `localStorage` no está particionado y es por usuario de Windows ([Microsoft Learn: Persist add-in state](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings)). La llamada actual de `https://localhost:3000` a `http://localhost:4111` funciona porque `localhost` es un contexto potencialmente confiable ([MDN Secure Contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)). El task pane debe seguir en HTTPS, así que **el instalador del hub tiene que generar y confiar un certificado localhost por usuario de Windows**. Es una carga real de instalación. Word en la web, Mac e iPad quedan fuera de alcance.

El hub debe ser **por usuario de Windows**: `userData` en `%APPDATA%` y `requestSingleInstanceLock()`, como dhub (`dhub/src/main/app.ts:51,173`). Un servicio para toda la máquina recrearía un servidor multiusuario y volvería a necesitar cuentas. El puerto `:3000` lo fija el manifiesto, y loopback se comparte entre sesiones de Windows. Por eso, con cambio rápido de usuario o RDP, solo un hub puede ser dueño del origen. Lo recomendado es aceptarlo y detectar el conflicto con un mensaje claro. Con varios PCs, cada hub es independiente: un documento abierto en el PC 2 llega sin historial ni preferencias. La solución es exportar/importar los datos del hub (SQLite + preferencias, sin `auth.json`). La sincronización queda como costura futura.

### Lo que se pierde, la costura que se conserva y las credenciales de proveedor

Sin cuentas se pierde la continuidad entre dispositivos, la colaboración, la copia de seguridad en servidor y cualquier oferta alojada con medición de uso. Microsoft recomienda precisamente SSO + base de datos en línea para preferencias entre dispositivos ([Microsoft Learn](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings)). Para que volver a introducir cuentas sea barato basta un puerto `RequestPrincipal { hubId }`, que hoy resuelve el adaptador `LocalHubTokenAuth`. Los servicios de dominio no reciben nunca un `userId`. No hay que conservar código de autenticación dormido.

Las credenciales de proveedor (`auth.json`) pertenecen al hub, es decir, al dueño de la máquina. Se guardan en un directorio propio de la app, escritas de forma atómica y con permisos solo para el propietario, como hace dhub (`dhub/src/main/adapters/pi-credentials.ts:46`). El `~/.pi/agent/auth.json` global nunca se importa en silencio. **El login de suscripción de Anthropic debe ocultarse o desactivarse.** Los términos prohíben ofrecerlo en aplicaciones de terceros, y "developers may not collect, store, or intermediate Claude.ai credentials or session tokens" ([Claude Code: Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). No tener cuentas no crea ninguna excepción. Sí se permiten la API key de Anthropic, la API key de OpenAI y, con aviso, el OAuth de ChatGPT/Codex. Que OpenAI tolere este último solo consta en fuentes secundarias ([Dev Genius](https://blog.devgenius.io/jump-ship-in-minutes-codex-oauth-now-works-in-opencode-d2708c32f571)) **[NO VERIFICADO contra los términos de OpenAI]**. Esto es crítico, porque el backend por defecto actual depende precisamente de la suscripción ChatGPT.

### Análisis por bandas de la pregunta B

| Banda | Implicación |
|---|---|
| Seguridad | Mejora neta: desaparece el puente OAuth y el CSRF asociado, pero se mantiene la autenticación por token; el principal de seguridad real pasa a ser la cuenta de Windows |
| Datos | `user_id` desaparece de todas las tablas; las preferencias de usuario pasan a ser un singleton del hub |
| Experiencia | Sin login; el coste aparece en la instalación (certificado, login de proveedor) y en el uso multi-PC (sin historial) |
| Legal y proveedores | Las credenciales siguen siendo personales del dueño; Anthropic solo por API key |
| Reversibilidad | Alta con el puerto `RequestPrincipal`; volver a SaaS sería otro producto, con cuentas reales y facturación por API key |

## C. SQLite con `node:sqlite` como único escritor, junto a los archivos de Pi

### `node:sqlite` gana por empaquetado, no por funcionalidad

Electron 44 incluye Node 24.18.1 o posterior ([Electron 44](https://electronjs.org/blog/electron-44-0)). Esa versión cumple el `node >=22.19.0` que exige Pi y trae `node:sqlite` sin flag. El módulo es síncrono, activa las claves foráneas por defecto y admite `timeout`, `backup()` en línea y `loadExtension()` ([Node.js sqlite](https://nodejs.org/api/sqlite.html)). Formalmente sigue siendo experimental en Node 24: pasa a release candidate en v25.7.0, y en v26 `DatabaseSync` se renombra a `Database`. Por eso conviene esconderlo tras un adaptador fino, como hace dhub. Las alternativas nativas tienen el coste conocido de Electron. Hay que reconstruirlas para el ABI con `@electron/rebuild`, sacarlas del asar con `asarUnpack` y, en Windows, activar `win_delay_load_hook` ([Electron: native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)). `@libsql/client` (que ya está instalado como dependencia de `@mastra/libsql`) trae `@libsql/win32-x64-msvc` nativo. Retirar Mastra elimina además los módulos nativos de libSQL y DuckDB del paquete.

| Driver | Código nativo | Empaquetado en Windows | Precedente local | Veredicto |
|---|---|---|---|---|
| `node:sqlite` | No | Nada que reconstruir ni desempaquetar | dhub, Electron 44, utilityProcess | **Recomendado** |
| sql.js / WASM | No | Simple, pero la BD vive entera en memoria y se persiste a mano | No | Descartado |
| `better-sqlite3` | Sí | Rebuild + `asarUnpack`; se rompe al actualizar Electron | No | Plan B |
| `@libsql/client` | Sí | Nativo, con poco precedente comunitario en Electron | Backend (vía Mastra) | Descartado |

Para el ORM hay tres caminos. `drizzle-orm@rc` con `drizzle-orm/node-sqlite` usa una versión RC ([Drizzle](https://orm.drizzle.team/docs/connect-node-sqlite)). `drizzle-orm/sqlite-proxy` sobre `DatabaseSync` no está probado. El tercero es SQL directo con un runner de migraciones basado en `PRAGMA user_version` y el SQL embebido como constantes, al estilo de `dhub/src/main/adapters/sqlite-migrations.ts`. Con solo cinco tablas, **el tercero es el de menor riesgo**: elimina la dependencia de una RC y de la carpeta de migraciones en `extraResources`. A cambio se pierde el query builder tipado, que se compensa con repositorios pequeños tras los puertos existentes. Las 4 migraciones Postgres actuales (0000–0003) no se pueden reutilizar en ningún caso.

### Esquema SQLite propuesto, sin usuarios

```sql
-- Al abrir: PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
--           PRAGMA foreign_keys = ON; busy timeout vía opción `timeout` (p. ej. 5000)
-- Fechas: INTEGER epoch ms. UUID: TEXT generado con crypto.randomUUID().

CREATE TABLE hub (                       -- singleton: instalación + antiguas user_preferences
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  installation_id          TEXT    NOT NULL,
  correction_instructions  TEXT    NOT NULL DEFAULT ''
                           CHECK (length(correction_instructions) <= 4000),
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE TABLE document (
  id                     TEXT PRIMARY KEY,
  external_document_key  TEXT NOT NULL UNIQUE,   -- stylistic.document.uuid.v1 del .docx
  title                  TEXT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  last_used_at           INTEGER NOT NULL
);

CREATE TABLE document_preferences (
  id                 TEXT PRIMARY KEY,
  document_id        TEXT NOT NULL UNIQUE REFERENCES document(id) ON DELETE CASCADE,
  default_genre      TEXT NOT NULL DEFAULT 'general'
                     CHECK (default_genre IN ('narrativa-literaria','ensayo-academico',
                                              'periodismo-cultural','general')),
  processing_config  TEXT NOT NULL DEFAULT '{"chunking":{"mode":"default"}}'
                     CHECK (json_valid(processing_config)
                            AND json_type(processing_config) = 'object'),
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE document_style_profile (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL UNIQUE REFERENCES document(id) ON DELETE CASCADE,
  profile_markdown  TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE workflow_run (
  id            TEXT PRIMARY KEY,                       -- runId que ve el add-in
  workflow_id   TEXT NOT NULL CHECK (workflow_id IN ('stylistic-workflow','feedback-workflow')),
  document_key  TEXT NOT NULL,                          -- conocido antes del paso 1
  document_id   TEXT REFERENCES document(id) ON DELETE SET NULL,
  status        TEXT NOT NULL CHECK (status IN ('pending','running','success','failed','canceled')),
  current_step  TEXT,
  input_json    TEXT NOT NULL,
  steps_json    TEXT NOT NULL DEFAULT '[]',             -- por paso: ok, salida/error, modelo, uso, coste
  result_json   TEXT,                                   -- {suggestions, cleanPatterns}
  error         TEXT,
  cost_usd      REAL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER
);
CREATE INDEX workflow_run_by_document ON workflow_run(document_key, started_at DESC);
CREATE INDEX workflow_run_by_status   ON workflow_run(status);
```

`resolveDocumentContext` se traduce a tres `INSERT … ON CONFLICT … DO UPDATE / DO NOTHING … RETURNING` dentro de una transacción. Las semánticas de "actualizar `title`, `default_genre` y `processing_config` solo si vienen informados" se conservan (`B/infrastructure/persistence/repositories/document.repository.ts:32-143`). `RETURNING` exige SQLite 3.35 o posterior, y `json_type`/`VACUUM INTO` dependen de la versión que embebe Node 24: **[NO VERIFICADO; muy probable]**. Se mantiene la clave sustituta `id` más `external_document_key UNIQUE`, en lugar de usar la clave del `.docx` como PK, para que la colisión de un `.docx` copiado (mismo UUID) quede visible. Ese problema también existe hoy. Al arrancar, las ejecuciones en `running` se marcan como `failed` con un mensaje explícito, porque ningún cliente puede reanudarlas. Hace falta además una política de retención que purgue runs antiguos.

La alternativa de añadir `workspace_id` a todas las tablas (propuesta en la nota de usuarios) cuesta poco, pero solo sirve si vuelven las cuentas. Para uso personal se descarta. La costura vive en el puerto `RequestPrincipal`, y una migración futura añadiría la columna.

### Pi guarda archivos, SQLite guarda el dominio, y no se mezclan

Pi no tiene base de datos. Persiste `auth.json`, `settings.json` y `models.json` como archivos, y las sesiones como JSONL (`pi-coding-agent/docs/configuration.md:7-24`). Ofrece costuras para auth (`AuthStorage.fromStorage(AuthStorageBackend)`, un contrato de "leer blob, escribir bajo bloqueo") y para settings, pero no para sesiones, cuya persistencia es un `_persist` privado (`pi-coding-agent/dist/core/session-manager.d.ts:225-255`). Llevar `auth.json` a SQLite aporta poco y obliga a reimplementar el bloqueo de refresco OAuth. Llevar las sesiones sería frágil. La recomendación es mantener los archivos de Pi en `userData/pi/`, junto a `userData/stylistic.db`, y pasar ambas rutas al mismo `utilityProcess` (patrón `--db=` / `--pi-agent-dir=` de `dhub/src/main/engine-host.ts:19`). Las copias de seguridad se hacen con `backup()` en línea o `VACUUM INTO` hacia `userData/backups/` con rotación, más una copia del directorio Pi en la misma tarea. Nunca se copia el `.db` en crudo con el WAL activo ([SQLite WAL](https://www.sqlite.org/wal.html)). La base de datos tampoco debe ir en una carpeta sincronizada ni de red.

Los vectores se eliminan. Si volvieran a hacer falta, `sqlite-vec` se carga en `node:sqlite` con `allowExtension: true`, pero es pre-v1 (v0.1.10-alpha.4) y requiere desempaquetar su `.dll` ([sqlite-vec](https://github.com/asg017/sqlite-vec)). En cuanto a migrar datos desde Postgres: no hay evidencia de usuarios en producción (`B/mastra/index.ts:34`, "In-memory is intentional for the local/MVP runtime"). Lo recomendado es empezar de cero, con un script opcional de exportación (`pg` → `node:sqlite`, sin `user_id`) solo si existen datos reales. Los snapshots de Mastra y la memoria no se migran.

### Análisis por bandas de la pregunta C

| Banda | Implicación de migrar a SQLite embebido |
|---|---|
| Ajuste al modelo sin usuarios | Encaje natural: un archivo por hub y por usuario de Windows, protegido por ACL; sin servidor ni Docker |
| Empaquetado | `node:sqlite` elimina todos los módulos nativos de base de datos (pg, libSQL, DuckDB) |
| Concurrencia | Un único escritor (el `utilityProcess`); WAL + busy timeout; volúmenes mínimos para un solo usuario |
| Coexistencia con Pi | Archivos de Pi al lado, sin transacciones compartidas; las referencias colgantes se toleran |
| Riesgos | API experimental en Node 24 y renombrado en v26; ORM en RC si se elige Drizzle |
| Reversibilidad | Alta: repositorios tras puertos; el SQL es portable salvo `json_*` y `ON CONFLICT` |

## Arquitectura objetivo consolidada

El Stylistic Hub es una app Electron 44 por usuario de Windows. El **proceso principal** gestiona la ventana, el bloqueo de instancia única, el certificado localhost, la generación y rotación del token, y el login de proveedores Pi (sin OAuth de Anthropic). Un **`utilityProcess` `stylistic-backend`** recibe `--db=userData/stylistic.db` y `--pi-agent-dir=userData/pi`. Ese proceso sirve en `https://localhost:3000`, ligado a `127.0.0.1`, tanto el task pane estático con el token inyectado como el API (`/api/health`, `/api/runs`, `/api/runs/:id`, `/api/runs/:id/cancel`, `/api/documents/resolve`, `/api/preferences`) con las cuatro guardas en cada petición. Dentro del proceso, el hexágono queda así: el dominio (prompts, esquemas zod, normalización, conteo de palabras) está copiado al byte; el runner orquesta los dos workflows; el puerto `LlmGateway` lo implementa pi-ai (`structuredCall` + `runWithPool` + `onPayload`); y el puerto de repositorios lo implementa `node:sqlite`. En el add-in, un `HubAdapter` sustituye a `MastraAdapter`/`FeedbackAdapter` detrás del mismo puerto. Así se conservan `RetryAnalysisDecorator`, `AnalyzeChunksHandler` y sus tests, y se elimina `@mastra/client-js`. Emular las rutas REST internas de Mastra para mantener el cliente sería frágil, porque sus rutas exactas no se verificaron.

### Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D1 | Runner propio + `workflow_run` | Mastra standalone, Effect, pi-durable | Workflows lineales, contrato de 4 estados, mínimo peso |
| D2 | pi-ai directo (`models.complete`) | `createAgentSession` headless | Sin herramientas; evita contaminar el prompt de sistema |
| D3 | Salida estructurada por herramienta forzada + `validateToolCall` + zod | Parseo de JSON en texto | Única vía con esquema estricto en pi-ai |
| D4 | Referencia de paridad = Codex (ChatGPT) vía Pi; pools Gemini/OpenAI opcionales | Gemini como referencia | Es el comportamiento por defecto actual |
| D5 | Sin scorers en línea | Mantener 4 jueces por ejecución | Solo observabilidad; coste y latencia |
| D6 | Sin cuentas; token del hub + guardas loopback/Host/Origin | API abierto en loopback | LNA no cubre localhost→localhost ni procesos locales |
| D7 | El hub sirve el task pane y el API en un solo origen HTTPS | Puerto `:4111` aparte con CORS | Elimina CORS y entrega el token sin endpoint expuesto |
| D8 | `node:sqlite` + SQL directo + `user_version` | Drizzle 1.0 rc, better-sqlite3 | Cero nativos; sin dependencia de una RC |
| D9 | Archivos de Pi en `userData/pi`, no en SQLite | `AuthStorageBackend` en SQLite | Beneficio pequeño; bloqueo de refresco ya resuelto por Pi |
| D10 | Sin login de suscripción de Anthropic | Ofrecer Claude Pro/Max | Prohibido por los términos de Anthropic |
| D11 | Fijar versiones exactas de `@earendil-works/*` (todas iguales) | Rangos `^` | Ritmo de versiones y cambios incompatibles |
| D12 | Empezar con datos desde cero | Migración automática PG → SQLite | Sin evidencia de datos de producción |

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| El modo estricto rechaza el esquema de sugerencias (`suggestedText` opcional con `additionalProperties:false` en OpenAI strict) | Media | Alto | Spike S1; `strict:'prefer'` + validación zod + re-pregunta; modelar `suggestedText` como requerido y nullable en la herramienta y normalizar después |
| El modelo `gpt-5.6-sol` o el transporte Codex no está disponible en Pi, o se comporta distinto del Codex-direct propio | Media | Alto | Spike S2; si hace falta, registrar un proveedor propio con `createProvider` |
| OpenAI restringe el OAuth de ChatGPT en terceros | Baja–media | Alto | Ofrecer API key como ruta principal alternativa; aviso en la UI |
| Cambios incompatibles en Pi | Alta | Medio | Versiones exactas, smoke test por paso antes de cada actualización |
| `node:sqlite` cambia de API (v26) | Media | Bajo | Adaptador fino |
| Certificado localhost y confianza por usuario fallan en algunos equipos | Media | Medio | Instalador con diagnóstico; código de emparejamiento como respaldo |
| Divergencia sutil de prompts que cambia la calidad | Media | Alto | Copia al byte + golden tests + comparación lado a lado (S7) |
| Pérdida de actualizaciones del perfil con chunks en paralelo | Alta (ya ocurre) | Medio | Decidir si se serializa por documento (mejora, no paridad) |

### Elementos abiertos que verificar con spikes

| Spike | Pregunta | Criterio de salida |
|---|---|---|
| S1 | ¿Acepta cada proveedor objetivo (Codex, OpenAI API, Gemini 3, Anthropic API) el esquema de `submit_suggestions`, `submit_profile` y `submit_feedback` en modo estricto con la herramienta forzada? | 20 llamadas por proveedor sin error de validación |
| S2 | ¿Expone Pi un modelo equivalente a `gpt-5.6-sol` sobre ChatGPT OAuth, con `toolChoice: 'required'`? | Llamada real con salida validada |
| S3 | ¿Qué forma tiene el payload de Google para `safetySettings` vía `onPayload`, y cómo aflora un bloqueo SAFETY (`stopReason`, `errorMessage`)? | Payload registrado + caso de bloqueo reproducido |
| S4 | ¿Qué versión de SQLite embebe el Node de Electron 44.x, y funcionan `RETURNING`, `json_type` y `VACUUM INTO`? | Script de prueba en el `utilityProcess` empaquetado |
| S5 | ¿Funciona en WebView2 de Word un task pane servido por el hub en `https://localhost:3000` con certificado propio, sin aviso de LNA? | Carga del add-in en una instalación limpia |
| S6 | ¿Acepta `ModelRuntime.create` un `AuthStorage` inyectado, o basta `agentDir` para aislar las credenciales? | Credenciales aisladas de `~/.pi` |
| S7 | ¿Produce el pipeline Pi resultados equivalentes a Mastra con el mismo modelo y la misma entrada? | Comparación en un corpus fijo; diferencias explicadas |
| S8 | ¿Confirma el runtime que Mastra Memory no lee ni escribe nada sin thread/resource? | Trazas o tablas de memoria vacías tras varias ejecuciones |
| S9 | ¿Qué dicen los términos primarios de OpenAI sobre el OAuth de ChatGPT en aplicaciones de terceros? | Texto primario citado |

### Plan por fases

| Fase | Contenido | Salida verificable |
|---|---|---|
| 0. Spikes | S1–S4 y S9 (los que pueden invalidar decisiones) | Informe de spikes; D3, D4 y D8 confirmadas o revisadas |
| 1. Núcleo de dominio | Copiar prompts, skills, constantes, esquemas zod, normalización y conteo de palabras; portar los 39 tests y añadir los que faltan | Golden tests en verde sin Mastra |
| 2. Persistencia | Esquema SQLite, runner `user_version`, repositorios `node:sqlite` (incluido `resolveDocumentContext`) con tests sobre `:memory:` | Tests de upsert y de CHECK en verde |
| 3. Gateway LLM | `structuredCall`, `runWithPool`, `retryAssistantCall`, `onPayload`, directorio Pi propio | Tests con proveedor falso + smoke test real (S2) |
| 4. Runner y API | `workflow_run`, start/poll/cancel/health, `AbortController`, marcado de runs huérfanos al arrancar, guardas de seguridad | Test de extremo a extremo start → poll → success/failed/canceled |
| 5. Shell del hub | Electron: instancia única, `utilityProcess`, certificado, token, servido del task pane, UI de login (sin Anthropic OAuth), backup/exportación | S5 y S6 superados en una instalación limpia |
| 6. Add-in | `HubAdapter` tras el puerto actual; retirar auth, `OfficeDialogAuthAdapter` y `@mastra/client-js`; migrar la clave de `localStorage` | Tests del add-in en verde; flujo completo en Word |
| 7. Retirada | Eliminar Better Auth, `pg`, `@mastra/*`, DuckDB, pgvector, Docker Compose; comparación S7 | Comparación lado a lado aceptada |
| 8. Opcional | Serializar `update-profile` por documento; evaluación offline con scorers; reevaluar `pi-durable` cuando se estabilice | Decisiones de producto registradas |

## Conclusión

La pregunta de partida era "qué alternativa a Mastra encaja con Pi". La investigación muestra que estaba mal planteada. Estos workflows nunca usaron lo que distingue a un motor de workflows, y la complejidad real del backend estaba en otro sitio: en los prompts, en la normalización de sugerencias y en una capa de transporte Codex-direct escrita a mano. Al pasar a Pi, el trabajo se desplaza de "elegir un orquestador" a "demostrar la salida estructurada estricta por proveedor". Ese es el único punto donde Pi exige más que Mastra, y por eso los spikes S1–S3 van antes que cualquier línea del runner.

La segunda lección es que quitar usuarios no quita la autenticación, solo cambia quién es el principal. Ese principal pasa a ser la cuenta de Windows, protegida por ACL, con un token por instalación como prueba de pertenencia. El mismo cambio vuelve más visible el riesgo que de verdad acota el producto: los términos de los proveedores de modelos. Anthropic ya cerró la vía de suscripción. El backend por defecto actual depende de la suscripción de ChatGPT, cuya tolerancia en terceros solo consta en fuentes secundarias. Antes de invertir en la reescritura conviene confirmar esa base legal, porque condiciona qué modelo es la "referencia" de la paridad.
