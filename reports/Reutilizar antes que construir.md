# Adoptar OpenWorkflow y reducir el backend a pegamento

Con el principio "no reinventar la rueda", la recomendación del informe anterior de escribir un runner propio (D1) **deja de estar justificada**. Ahora existe una herramienta mantenida que cumple todas las restricciones: **OpenWorkflow 0.11.0 (Apache-2.0, 356 KB, una sola dependencia)**. Incluye un backend SQLite sobre `node:sqlite` (`openworkflow/sqlite`), workers dentro del mismo proceso, estado `canceled` y `cancelWorkflowRun()` ([npm](https://registry.npmjs.org/openworkflow); [tarball 0.11.0](https://registry.npmjs.org/openworkflow/-/openworkflow-0.11.0.tgz)). Replica `stylistic-workflow` (4 pasos) y `feedback-workflow` (2 pasos) usando como nombres de `step.run` los mismos ids de paso que hoy. Lo que queda por escribir es pegamento de menos de 100 líneas (estimación): tres rutas HTTP, un mapa de estados, un registro `runId → AbortController` y la desactivación de reintentos. La salida es un spike de un día; si falla, el plan B es Mastra standalone con `InMemoryStore`. En la capa LLM, Pi sigue sin ofrecer salida estructurada, fallback entre modelos ni `safetySettings`. En los dos primeros casos no es un hueco por llenar con una librería, sino una **decisión explícita del mantenedor** ([#1086](https://github.com/earendil-works/pi/issues/1086); [#9242](https://github.com/earendil-works/pi/issues/9242)). Por eso `structuredCall` (~50 líneas), `runWithPool` (~30) y el shim de `onPayload` (~5) son pegamento sobre primitivas de Pi, no motores. En la fontanería del hub casi todo se adopta: Hono, `node:sqlite` con `backup()`, electron-builder/electron-updater y las APIs propias de Electron. Solo hay tres piezas propias justificadas: el supervisor del `utilityProcess`, la guarda de `Host` y el runner de migraciones `user_version` (que se reutiliza de dhub). Lo que más cambia desde el informe anterior no es técnico sino de proveedor. OpenAI tiene ahora un programa oficial, **Sign in with ChatGPT**, que usa la Responses API pública. Pi lo expone en el proveedor `openai`. En cambio, el backend actual y el proveedor `openai-codex` de Pi reutilizan el cliente OAuth de Codex CLI contra `chatgpt.com/backend-api/codex`. Esto mueve la referencia de paridad y abre una decisión legal que depende de la licencia y del modelo de distribución de Stylistic.

Leyenda de citas locales: `B/` = `D:\dev\eln\stylistic\stylistics-backend\src\`, `A/` = `D:\dev\eln\stylistic\stylistic-addon\src\`, `PI/` = `D:\Método PEN\course-platform\node_modules\@earendil-works\` (Pi 1.0.2 instalado), `dhub/` = `D:\dev\disble\d-hub\dhub\`. **[NO VERIFICADO]** marca lo que no se comprobó contra una fuente primaria o en ejecución.

## OpenWorkflow sustituye al runner propio con menos de cien líneas de pegamento

### Por qué el runner propio ya no pasa el filtro del principio

El `AGENTS.md` del hub solo admite código propio en tres casos: (1) ninguna herramienta mantenida cubre la necesidad; (2) todas las candidatas son incompatibles con Pi, Electron, SQLite embebido o el uso offline monousuario; (3) integrar cuesta claramente más que el código que se sustituye, y la parte propia queda pequeña y aislada tras un puerto (`D:/dev/eln/stylistic/stylistic-hub/AGENTS.md:16-19`). El runner de 200–400 líneas del informe anterior incluía la tabla `workflow_run`, la máquina de estados, la consulta por id y la cancelación. Ahora no cumple ninguna de las tres condiciones. La vía SQLite de OpenWorkflow carga `DatabaseSync` desde `node:sqlite` mediante `createRequire` y se abre con `BackendSqlite.connect(path)`. El paquete separado `@openworkflow/backend-sqlite` está **deprecado**, porque esa funcionalidad "has moved into `openworkflow` core" ([tarball backend-sqlite 0.6.3](https://registry.npmjs.org/@openworkflow/backend-sqlite/-/backend-sqlite-0.6.3.tgz)).

Las APIs que cubren el contrato del add-in están en los `.d.ts` publicados:

- `defineWorkflow(spec, fn)`, con un esquema de entrada de tipo `StandardSchemaV1`.
- `runWorkflow(spec, input)`, que devuelve un handle; su `workflowRun.id` sirve como `runId`.
- `backend.getWorkflowRun(...)` y `listWorkflowRuns(...)`.
- `cancelWorkflowRun(id)`, válido para runs en `pending`, `running` o `sleeping`.
- `newWorker({ concurrency, leaseDurationMs })`, con `start()`, `stop()` y `tick()`.
- `step.run({ name, retryPolicy? }, fn)` dentro de la función del workflow.

Todo ello está en `dist/client/client.d.ts` y `dist/core/*.d.ts` del [tarball](https://registry.npmjs.org/openworkflow/-/openworkflow-0.11.0.tgz).

El requisito `engines.node >=22.22.0` era la incógnita de la nota de motores, y ya está resuelto. El Electron 44.5.1 instalado informa `process.versions.node` = **24.21.0** (probe local registrada en las notas de verificación), y Electron 44 se anunció con Node 24.18.1 ([Electron 44](https://www.electronjs.org/blog/electron-44-0)).

El contrato que hay que replicar es estrecho. El add-in arranca un run y recibe un `runId`, hace polling cada segundo, puede cancelar, y solo interpreta `running`, `success`, `failed` y `canceled`; `suspended` y `paused` los rechaza (`A/adapters/mastra/MastraAdapter.ts:127-219`). El intervalo de 1 s y los 3 reintentos con backoff siguen **[NO VERIFICADO]** línea a línea en esta ronda. En cualquier caso, el add-in ya iba a cambiar `MastraAdapter` por un `HubAdapter` detrás del mismo puerto, así que la forma de la respuesta del API la decide el hub.

### El pegamento mínimo y dos huecos semánticos

La correspondencia de estados es directa:

| OpenWorkflow | Estado que ve el add-in |
|---|---|
| `pending`, `running`, `sleeping` | `running` |
| `completed`, `succeeded` | `success` |
| `failed` | `failed` |
| `canceled` | `canceled` |

Los estados vienen del `WorkflowRunStatus` de `dist/core/workflow-run.d.ts`.

Hay dos huecos reales, y ambos se resuelven con poco código.

**Primer hueco: la cancelación no aborta la llamada en curso.** `cancelWorkflowRun` solo cambia el estado en la base de datos. La API de pasos no tiene `AbortSignal`, y un grep de `AbortController` sobre `dist` no devuelve nada (`dist/worker/worker.js:280-296`). Una llamada a Pi que ya esté en vuelo no se aborta. El pegamento es un `Map<runId, AbortController>`: se crea dentro de la función del workflow, su `signal` se pasa a pi-ai, y el endpoint de cancelación llama a `cancelWorkflowRun` y luego a `abort()`.

**Segundo hueco: los reintentos por defecto.** Los pasos de OpenWorkflow reintentan por defecto y los de Mastra no. Hay que fijar `retryPolicy` sin reintentos. Los valores por defecto no se leyeron **[NO VERIFICADO]**.

La nota de motores no recoge dos ajustes más, y los dos importan:

- **Concurrencia del worker.** El add-in analiza chunks en paralelo (`A/domain/pipeline/handlers/AnalyzeChunksHandler.ts:83-178`). Con `concurrency: 1` todas las ejecuciones se serializarían. Eso eliminaría de paso la carrera de último escritor sobre el perfil, pero cambiaría la latencia percibida, y por tanto no es paridad. La concurrencia debe igualar el paralelismo del add-in, cuyo valor exacto está **[NO VERIFICADO]**.
- **Reanudación tras reinicio.** Un motor durable reanuda runs interrumpidos, y el cliente no reanuda nunca. Para conservar la semántica del informe anterior, en el que los runs huérfanos se marcaban como fallidos, el arranque debe llamar a `listWorkflowRuns` y cancelar los que sigan en `pending`/`running`. Así se evita relanzar llamadas LLM que nadie va a consultar.

La latencia de arranque depende del intervalo de polling del worker, que no aparece en los `.d.ts` **[NO VERIFICADO]**. `worker.tick()` permite despachar justo después de encolar.

### Clasificación de motores con la evidencia actual

| Rango | Motor | Encaje | Coste principal | Veredicto |
|---|---|---|---|---|
| 1 | OpenWorkflow 0.11.0 | `node:sqlite` integrado, en proceso, Standard Schema, `canceled`; 1.335 estrellas, último push 2026-10-14 ([GitHub API](https://api.github.com/repos/openworkflowdev/openworkflow)) | Pre-1.0 y sin política de estabilidad publicada; cancelación solo de estado | **Adoptar, condicionado al spike S0** |
| 2 | Mastra 1.77.0 standalone | API idéntica a la actual (`startAsync`, `getWorkflowRunById`, `cancel`) y `abortSignal` por paso que llega a pi-ai ([tarball](https://registry.npmjs.org/@mastra/core/-/core-1.77.0.tgz)) | **76 MB** desempaquetado y **30 dependencias** obligatorias (hono, posthog-node, A2A, AI SDK v5/v6/v7); `@mastra/libsql` arrastra libSQL nativo solo para `win32-x64` ([npm libsql](https://registry.npmjs.org/libsql/latest)); `InMemoryStore` pierde los runs al cerrar | Plan B si falla S0 |
| 3 | Effect 4.0.5 (`effect/workflow` + `SingleRunner` + `@effect/sql-sqlite-node`) | Paquete estable, `node:sqlite`, `poll` e `interrupt` ([tarball](https://registry.npmjs.org/effect/-/effect-4.0.5.tgz)) | Módulos marcados `@stability unstable`; impone el estilo Effect en todo el backend | Plan C |
| 4 | `@earendil-works/pi-durable` 1.2.0 | Nativo de Pi, `node:sqlite`, abort en cascada ([npm](https://registry.npmjs.org/@earendil-works%2Fpi-durable)) | "**Experimental.** The API changes without notice"; cambios incompatibles entre 1.1.0 y 1.2.0, publicadas con cinco días de diferencia; pensado como arnés de conversación | Vigilar |
| ✗ | Vercel Workflow, DBOS TS, Absurd, Inngest/Restate/Hatchet, LangGraph, XState, workflow-es, liteque | — | Postgres, servidor, transformación de compilador, forma equivocada o sin mantenimiento ([DBOS](https://docs.dbos.dev/typescript/reference/configuration); [Local World](https://useworkflow.dev/docs/deploying/world/local-world); [absurd-sdk](https://registry.npmjs.org/absurd-sdk)) | Descartados |

Mastra conserva un atractivo: es la única opción con señal de aborto por paso, y su API coincide con la que el add-in usa hoy. Aun así, la búsqueda no encontró ningún informe de Mastra dentro de Electron. Su árbol de dependencias tampoco se puede declarar fuera, y que el *tree-shaking* elimine `posthog-node` o `hono` está **[NO VERIFICADO]**. Socket.dev menciona además versiones maliciosas de `@mastra/libsql` en una campaña de cadena de suministro ([Socket](https://socket.dev/npm/package/@mastra/libsql/overview/1.15.0)) **[NO VERIFICADO en detalle]**. Si se usara Mastra con persistencia sobre `node:sqlite`, habría que implementar `WorkflowsStorage`, una clase abstracta de 8 métodos que evoluciona con lanzamientos semanales. Eso sería código propio contra una interfaz interna inestable, justo lo que el principio intenta evitar.

Con OpenWorkflow, el esquema SQLite propio pierde la tabla `workflow_run`: los runs, su salida y su error pasan a `workflows.db`, propiedad del motor. Si se necesitan historial por documento o coste por run, va como metadato en la salida del paso o en una tabla de auditoría mínima, que es una **decisión abierta**. La purga de runs antiguos depende de que el backend exponga borrado, y eso está **[NO VERIFICADO]**.

## La capa LLM es pegamento sobre primitivas que Pi ya trae

### Salida estructurada y fallback: el mantenedor eligió no incluirlos

npm `latest` de `@earendil-works/pi-ai` es **1.2.0** (2026-10-12) ([npm](https://registry.npmjs.org/@earendil-works/pi-ai)). El CHANGELOG desde 1.0.2 no añade salida estructurada, fallback ni safety ([CHANGELOG](https://github.com/earendil-works/pi/blob/main/packages/ai/CHANGELOG.md)).

El mantenedor cerró la petición de *JSON schema output* con esta respuesta: "I do not want to do that in pi-ai. Instead, I propose you expose a tool … it must call at the end of its turn, which records the JSON. This is more reliable and supported by all providers" ([#1086](https://github.com/earendil-works/pi/issues/1086)). Usar ese patrón es, literalmente, adoptar la herramienta como fue diseñada.

Las piezas que necesita el patrón ya están en pi-ai: herramientas TypeBox, `constrainedSampling: { type: 'json_schema', strict: 'prefer' }`, `toolChoice` de forzado por API y `validateToolCall`. Los valores de forzado de `toolChoice` son Anthropic `{type:'tool',name}`, Google `'any'` y Codex `'required'`. 1.2.0 añade además dos correcciones que benefician directamente a una llamada forzada:

- El reintento no estricto de Anthropic cuando el proveedor rechaza el conjunto estricto de herramientas.
- El `argumentsError` para argumentos de herramienta con JSON mal formado.

Ninguna librería publicada envuelve este patrón sobre Pi. El puente oficial `@ai-sdk/harness-pi` va en la dirección contraria: ejecuta Pi como arnés dentro del AI SDK, exige un sandbox, se declara experimental y dice expresamente que "Pi does not support structured output" ([ai-sdk.dev](https://ai-sdk.dev/providers/ai-sdk-harnesses/pi)). Escribir un adaptador Pi→`LanguageModelV3` para usar `generateObject` sería más código que `structuredCall`, y reintroduciría una segunda capa de proveedores.

La verificación añade un matiz importante. El Codex-direct actual no usa herramientas, sino `text.format` `json_schema` con **`strict: false`** (`B/mastra/agents/codex-direct/codex-direct.protocol.ts:84-89`). La herramienta forzada con `strict: 'prefer'` es más estricta que hoy. Por eso un rechazo de esquema en el spike S1 sería un cambio de comportamiento, no una regresión de paridad.

El fallback entre proveedores siguió la misma suerte que la salida estructurada. La propuesta #9242 se cerró como *not planned* y un comentario la orientó hacia una extensión ([#9242](https://github.com/earendil-works/pi/issues/9242)). Pi sí trae reintento transitorio del mismo modelo: `retryAssistantCall` falla rápido por cuota y facturación y nunca reintenta un aborto (`PI/pi-ai/dist/utils/retry.d.ts:1-47`). Sus clasificadores se ampliaron en versiones recientes (`server_busy`, *upstream stream*). Desde main, además, el cambio de modelo elimina los bloques de *thinking* del modelo anterior (#10995). `runWithPool` queda así en un bucle de unas 30 líneas sobre `retryAssistantCall`, que pasa al siguiente modelo cuando el actual se agota, el error no es reintentable o la validación falla. No contiene lógica de proveedor. Las librerías genéricas de fallback de IA están hechas para modelos del AI SDK y exigirían el puente descartado.

### Safety de Google, directorio de Pi y login: más pequeños de lo estimado

`onPayload` recibe los parámetros exactos de `generateContentStream`, es decir `{model, contents, config}`, y si devuelve un objeto este los reemplaza (`PI/pi-ai/dist/api/google-generative-ai.js:44-49`; lo mismo en `google-vertex.js:48`). `@google/genai` declara `safetySettings` dentro de `GenerateContentConfig` (`genai.d.ts:5677`). La forma del payload, que el informe anterior dejaba sin verificar, **queda verificada estáticamente**: el shim es una función de unas 5 líneas que añade `config.safetySettings` solo cuando `model.api` es Google o Vertex. La verificación también reduce el alcance: `providerOptions.google` solo se aplica cuando `genero === "narrativa-literaria"` (`B/.../correct-text/correct-text.helpers.ts:190-218`), así que el shim afecta a un género y a un proveedor. Sigue sin confirmarse en vivo qué `stopReason` y qué mensaje produce un bloqueo SAFETY. `mapStopReason` agrupa `SAFETY`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII` y `RECITATION` (`PI/pi-ai/dist/api/google-shared.js:383-400`), pero el valor que devuelve está **[NO VERIFICADO]**.

El "directorio de agente propio" deja de ser un elemento a construir. Es `ModelRuntime.create({ authPath, modelsPath })` bajo `userData/pi`, unas 10 líneas, igual que `createAppOwnedModelRuntime` en `D:\Método PEN\course-platform\server\pi-runtime.ts:38-55`.

Para el login, Pi aporta el protocolo y el estado: `ModelRuntime.login(providerId, type, interaction)` con `prompt`/`notify` (`PI/pi-coding-agent/dist/core/model-runtime.d.ts:107-108`), y el refresco automático bajo bloqueo ([`PI/pi-ai/README.md:1728-1772`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)). La única UI que trae es la TUI de terminal. Lo que falta es el transporte HTTP/IPC de los eventos `prompt`/`notify` y la pantalla. El contrato ya probado es `dhub/src/main/domain/login.ts` (339 líneas, estructuralmente compatible con `AuthInteraction`) junto con el adaptador `dhub/src/main/adapters/pi-login.ts` (53 líneas). Lo razonable es extraerlos y reutilizarlos en lugar de diseñar otros. dhub es privado y no tiene licencia, así que su reutilización depende del permiso del propietario.

### El proveedor de suscripción cambia de ruta

El README de Pi presenta "**OpenAI** (Sign in with ChatGPT: uses the ChatGPT subscription with the OpenAI API)" y marca `openai-codex` como *legacy* (`PI/pi-ai/README.md:1733,1814`). Los dos catálogos listan `gpt-5.6-sol`, junto a la familia GPT-6.

OpenAI documenta que "ChatGPT plan usage is available to all open-source partners and selected private clients" ([quickstart](https://developers.openai.com/siwc/quickstart.md)). Para apps de pago o alojadas en remoto exige un formulario de interés. El flujo OSS "registers a user-defined agent" con un `ext_agent_host_id` persistido ([token sharing OSS](https://developers.openai.com/siwc/token-sharing-open-source.md)).

Todo esto contrasta con el backend actual, que reutiliza el cliente de Codex CLI (`app_EMoamEEZ73f0CkXaXp7hrann`) contra `https://chatgpt.com/backend-api/codex/responses` (`B/mastra/agents/codex-direct/codex-direct.constants.ts:15-25`).

Queda **[NO VERIFICADO]** que el login *Sign in with ChatGPT* de Pi sea el flujo OSS de registro dinámico y no una reutilización del cliente de Codex. Las entradas de 1.1.0 sobre "agent name hint" y "Codex browser login originator" sugieren que conviven los dos mecanismos.

Anthropic, en cambio, sigue prohibiendo el login Claude.ai en terceros ([Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)). Por eso Claude solo se ofrece con API key.

## La fontanería del hub se adopta casi entera

El servidor es **Hono 4.13.13 + `@hono/node-server` 2.1.5** (MIT; unos 74 M y 69 M descargas semanales). Sus middlewares integrados cubren casi todas las guardas: `cors`, `bearer-auth`, `secure-headers`, `ip-restriction` (con `getConnInfo` para comprobar el peer loopback), `serve-static`, `csrf` y `body-limit` ([npm hono](https://registry.npmjs.org/hono); [tarball](https://registry.npmjs.org/hono/-/hono-4.13.13.tgz)). Falta una lista blanca de `Host` contra DNS rebinding. La única implementación lista para usar está en el SDK MCP v2, que está en beta ([hostHeaderValidation](https://ts.sdk.modelcontextprotocol.io/v2/api/@modelcontextprotocol/express/middleware/hostHeaderValidation.html)). Importarlo para 10 líneas es peor trato. course-platform ya tiene esa guarda escrita (`server/app.ts:153`) y es el precedente que conviene copiar. La inyección del token en `index.html` también es propia: se lee el archivo una vez y se reemplaza un marcador. Que `bearer-auth` compare en tiempo constante, y que `serve()` de la 2.x acepte `createServer: https.createServer` con `serverOptions`, están **[NO VERIFICADO]**. La 2.1.5 tiene solo dos días.

Para el certificado localhost, `office-addin-dev-certs` 3.0.1 (MIT, Microsoft) se puede llamar como librería, pero no encaja en producción. Sus valores por defecto son 30 días de validez, la carpeta `~/.office-addin-dev-certs`, la CA "Developer CA for Microsoft Office Add-ins" y telemetría `office-addin-usage-data`. Depende además de `mkcert` 3.2.0, cuya última publicación es de 2023 ([tarball](https://registry.npmjs.org/office-addin-dev-certs/-/office-addin-dev-certs-3.0.1.tgz); [mkcert](https://registry.npmjs.org/mkcert)).

El problema decisivo es la colisión de nombre. `uninstallCaCertificate` busca por el nombre fijo de la CA, así que las herramientas de desarrollo de Office instaladas en la misma máquina pueden retirar la CA del hub, y el hub la de ellas. La recomendación es generar CA y certificado hoja con `selfsigned` 5.5.0 o `@peculiar/x509` 2.2.0 (MIT, ambos mantenidos) ([selfsigned](https://registry.npmjs.org/selfsigned); [@peculiar/x509](https://registry.npmjs.org/@peculiar/x509)). La instalación se hace con el cmdlet de Windows `Import-Certificate -CertStoreLocation cert:\CurrentUser\Root`, el mismo mecanismo que usa el script de Microsoft, y la desinstalación filtrando por el *subject* propio. Son unas 15–30 líneas.

Que `selfsigned` firme una hoja con una CA propia está **[NO VERIFICADO]**; `@peculiar/x509` es la alternativa segura. También está **[NO VERIFICADO]** que Windows 11 muestre un aviso modal al añadir una raíz en `CurrentUser\Root`. Hay que explicarlo antes y gestionar el "No". Las APIs de certificados de Electron no sustituyen este paso, porque WebView2 usa el almacén del sistema (inferencia no probada).

El registro del add-in sigue la misma lógica: **reutilizar el mecanismo, no el paquete CLI**. `office-addin-dev-settings` 4.0.1 escribe un único valor de cadena, `<id del manifiesto>` = `<ruta>`, en `HKCU\SOFTWARE\Microsoft\Office\16.0\Wef\Developer` cuando el manifiesto es XML (`lib/dev-settings-windows.js:47,190-192`). A cambio arrastra `inquirer`, `adm-zip`, `open`, telemetría y un peer del M365 Agents Toolkit ([tarball](https://registry.npmjs.org/office-addin-dev-settings/-/office-addin-dev-settings-4.0.1.tgz)). Escribir ese valor con `reg.exe` cuesta unas 10 líneas. El riesgo de fondo no cambia con la herramienta. Microsoft documenta el sideloading como "Not for production add-ins", y los canales de producción son Marketplace y el despliegue desde el centro de administración ([Deploy and publish](https://learn.microsoft.com/en-us/office/dev/add-ins/publish/publish)). El manifiesto debe seguir siendo XML, porque el manifiesto unificado JSON toma otra vía.

En persistencia no hay ORM ni migrador estable que apunte a `node:sqlite`. Drizzle 0.45.4, el `latest`, no tiene `node-sqlite`; solo 1.0.0-rc.4 lo trae ([npm](https://registry.npmjs.org/drizzle-orm)). Kysely 0.29.6 necesita un driver con forma de better-sqlite3, y los adaptadores comunitarios tienen entre 12 y 31 descargas semanales ([kysely tarball](https://registry.npmjs.org/kysely/-/kysely-0.29.6.tgz)). La opción de menor riesgo es reutilizar el runner `PRAGMA user_version` de dhub (`dhub/src/main/adapters/sqlite-migrations.ts:163-179`, unas 20 líneas), extraído y no reescrito, con cada migración dentro de `BEGIN`/`COMMIT`.

Las copias de seguridad no necesitan librería. `backup()` existe desde Node v23.8.0, y la probe confirmó `VACUUM INTO` en Electron 44.5.1 con SQLite 3.53.4 ([Node 24 sqlite](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)).

El empaquetado tampoco requiere código propio:

- **Instalador y actualizaciones:** electron-builder 26.15.3 con NSIS por usuario, más electron-updater 6.8.9 publicando en GitHub Releases ([electron-builder](https://registry.npmjs.org/electron-builder); [electron-updater](https://registry.npmjs.org/electron-updater)).
- **Bundler:** electron-vite, fijado en 5.x porque la 6.0.0 se publicó el 2026-10-14.
- **Instancia única, bandeja y autoarranque:** las APIs propias de Electron, como ya hace dhub (`app.ts:173`, `tray.ts:26`, `electron-login-item.ts:19`).
- **Firma de código:** Azure Artifact Signing mediante `win.azureSignOptions`. Solo admite desarrolladores individuales de EE. UU. y Canadá, no emite certificados EV y la reputación SmartScreen se acumula con el tiempo ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart); [FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq)).

Quedan dos piezas propias justificadas por la condición 1. La primera es el **supervisor del `utilityProcess`**. Electron emite `spawn`, `exit` y `error` pero "describes no built-in restart behavior" ([utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)), y PM2 o forever apuntan a `child_process`. Son unas 30–50 líneas con backoff, tope de bucle de fallos, heartbeat o `/health`, y log rotado.

La segunda es el **almacenamiento de credenciales**. Pi es dueño de las credenciales de proveedor, y su `auth.json` vive en `userData/pi` con escritura atómica (`dhub/src/main/adapters/pi-credentials.ts:46`). `safeStorage` (DPAPI) existe, pero aporta poco frente al modelo de amenaza real. DPAPI cifra por usuario de Windows, así que otro proceso del mismo usuario puede descifrarlo igual que puede leer `userData` (inferencia). Las ACL del perfil ya separan a otros usuarios. Se pospone; solo se reconsidera si S6 muestra que `ModelRuntime.create` acepta un `AuthStorage` inyectado y el producto exige cifrado en reposo.

## Reutilizar vs construir, componente a componente

| Componente | Necesidad | Herramienta adoptada (versión, licencia) | Pegamento propio estimado | Justificación según el principio |
|---|---|---|---|---|
| Orquestación de workflows | 2 workflows lineales con start/poll/cancel y 4 estados | `openworkflow` 0.11.0, Apache-2.0 (`openworkflow/sqlite`) | <100 líneas: rutas, mapa de estados, `AbortController`, `retryPolicy`, cancelar huérfanos al arrancar | Existe una herramienta compatible; el runner propio no cumple ninguna de las 3 condiciones. Plan B: `@mastra/core` 1.77.0 |
| Esquemas de entrada de workflow | Validación en las fronteras de paso | zod 4 (ya en el código; OpenWorkflow acepta Standard Schema) | 0 | Reutiliza los esquemas y tests actuales |
| Salida estructurada | JSON validado por esquema desde 5 pasadas LLM | pi-ai 1.2.0 (MIT): herramienta TypeBox + `constrainedSampling` + `toolChoice` + `validateToolCall` | ~50 líneas (`structuredCall`) | El mantenedor rechazó el *response format* y recomendó este patrón; no hay envoltorio publicado |
| Fallback de modelos | Pools ordenados (Gemini, OpenAI, OpenCode-Go, LM Studio) | pi-ai `retryAssistantCall` | ~30 líneas (`runWithPool`) | Fallback cerrado como *not planned*; las librerías de fallback exigen el AI SDK |
| Safety de Google | `BLOCK_NONE` en `narrativa-literaria` | pi-ai `onPayload` | ~5 líneas | Hook soportado; forma verificada en el código |
| Directorio de Pi | Credenciales aisladas de `~/.pi` | `ModelRuntime.create({authPath, modelsPath})` | ~10 líneas | Pi lo resuelve; precedente en course-platform |
| Login de proveedor | OAuth/API key desde la UI del hub | `ModelRuntime.login/logout` (Pi) | Transporte de eventos + UI; contrato copiado de dhub (339 + 53 líneas) | Pi solo trae TUI; se reutiliza un contrato probado en lugar de diseñar otro |
| Evals (sustituto de scorers) | Calidad offline | Vitest (asserts deterministas); `vitest-evals` 0.17.0, Apache-2.0, opcional | Juez LLM = otra `structuredCall` | Los scorers deterministas no necesitan librería |
| Certificado localhost | HTTPS confiable por usuario sin admin | `selfsigned` 5.5.0 o `@peculiar/x509` 2.2.0 (MIT) + `Import-Certificate` de Windows | 15–30 líneas | `office-addin-dev-certs` colisiona por nombre de CA, trae telemetría y tiene una validez de 30 días (condición 3) |
| Registro del add-in | Sideload por usuario | Clave `HKCU\…\Wef\Developer` + `reg.exe` | ~10 líneas | El paquete arrastra dependencias interactivas sin uso para un usuario final; se reutiliza el mecanismo |
| Servidor HTTP | Task pane + API en el mismo origen HTTPS | `hono` 4.13.13 + `@hono/node-server` 2.1.5 (MIT) | 0 | Adopción directa |
| Guardas de seguridad | Peer loopback, Host, Origin, token | Hono `ip-restriction`, `cors`, `bearer-auth`, `secure-headers`, `body-limit` | ~10 líneas (Host) + ~15 (inyección de token) | No hay middleware de Host maduro; se copia el precedente de course-platform |
| Driver SQLite | BD embebida sin nativos | `node:sqlite` (Node 24.21.0 en Electron 44.5.1; *release candidate*) | Adaptador fino | Integrado; probe en verde |
| Migraciones | Esquema versionado | Runner `user_version` de dhub (reutilizado) | ~20 líneas | No hay ORM estable sobre `node:sqlite`; Drizzle 1.0 cuando sea GA |
| Copias y exportación | Snapshot consistente e importación validada | `node:sqlite` `backup()` / `VACUUM INTO` | ~30 líneas (rotación, validar `user_version` + `integrity_check`, swap) **[estimación]** | Integrado |
| Bundler | Main + preload + backend | `electron-vite` 5.x (MIT) | Configuración | Adopción; 6.0 demasiado reciente |
| Instalador | Per-user sin admin | `electron-builder` 26.15.3 NSIS (MIT) | Configuración | Adopción; precedente en dhub |
| Actualizaciones | Auto-update | `electron-updater` 6.8.9 (MIT) + GitHub Releases | ~5 líneas | Adopción |
| Firma | Evitar SmartScreen | Azure Artifact Signing vía `azureSignOptions` | Configuración + cuenta Azure | Adopción si hay elegibilidad; si no, OV o sin firmar (precio **[NO VERIFICADO]**) |
| Instancia única, bandeja, autoarranque | Un hub por usuario | `requestSingleInstanceLock`, `Tray`, `setLoginItemSettings` | Mínimo | Electron |
| Supervisión del backend | Reinicio y salud del `utilityProcess` | Eventos de `utilityProcess` | 30–50 líneas | **Propio justificado (condición 1)**: no existe supervisor para `utilityProcess` |
| Logs | Logs rotados del backend | `electron-log` **[versión NO VERIFICADA]** | Conexión de stdout/stderr | Adopción preferida a un escritor propio |
| Credenciales de proveedor | Secretos en reposo | Almacén de archivos de Pi (`auth.json` atómico) | 0 | Pi es dueño de las credenciales; `safeStorage` pospuesto |
| Dominio | Prompts, esquemas, normalización, conteo de palabras | — (copia al byte de `B/`) | Código de dominio existente | Es el dominio; el principio lo deja expresamente como código propio |

## Lo que la verificación confirmó, refutó y dejó abierto

| Afirmación del informe anterior | Estado | Impacto |
|---|---|---|
| Sin `MODEL_BACKEND`, todo va a Codex-direct `gpt-5.6-sol` (`codex-subscription.selector.ts:38-56`) | CONFIRMADO en código; `.env` no leído | D4 se mantiene; revisar `.env` antes de congelar la referencia |
| El cuerpo omite `temperature`/`providerOptions` | CONFIRMADO; además usa `text.format` `json_schema` `strict:false` | La herramienta estricta es más estricta que hoy; S1 mide un cambio, no una regresión |
| Opciones de Google (thinking, `BLOCK_NONE`) generales | PARCIAL: solo en `narrativa-literaria` | El shim `onPayload` se reduce a un género |
| Pools Gemini/OpenAI con `maxRetries: 3` | PARCIAL: incluyen `opencode-go/deepseek-v4-flash` y `lmstudio/qwen3.6-35b-a3b@q2_k_xl` | `runWithPool` necesita esos proveedores en modo `metered` |
| Anthropic prohíbe login Claude.ai en terceros | CONFIRMADO literal | D10 se mantiene |
| Pi eliminó Gemini CLI/Antigravity | CONFIRMADO; fecha corregida a 0.71.0 (2026-04-30) | Sin cambio |
| Pi latest = 1.0.2 | DESACTUALIZADO: 1.2.0, con dos minor incompatibles (1.0.3 renombró `azure-openai-responses`→`azure`) | Fijar 1.2.x exacta (D11 se refuerza) |
| `pi-durable` no publicado | ACTUALIZADO: 1.2.0 en npm, aún "Experimental" | Se puede instalar para pruebas; sigue en "vigilar" |
| `node:sqlite` funciona en `utilityProcess` de Electron 44 (dhub) | CONFIRMADO | D8 se mantiene |
| `node:sqlite` "experimental en Node 24; renombrado en v26" | REFUTADO en parte: *release candidate* desde v24.15.0; `DatabaseSync` queda como alias deprecado ([Node 26](https://nodejs.org/api/sqlite.html)) | Riesgo de API baja a bajo |
| SQLite/RETURNING/json_type/VACUUM INTO **[NO VERIFICADO]** | CONFIRMADO por probe: 3.53.4 en Electron 44.5.1 (modo node, no `utilityProcess` empaquetado) | **S4 cerrado** |
| Drizzle solo en rc | CONFIRMADO (0.45.4 frente a 1.0.0-rc.4) | D8 se mantiene |
| Sin `responseFormat`; herramienta forzada | CONFIRMADO | D3 se mantiene, ahora respaldado por el mantenedor |
| Sin fallback de cliente | CONFIRMADO; la cita `types.d.ts:239-243` era incorrecta (correcta: `:771-774`, `:796`) | Corregir cita |
| `GoogleOptions` sin `safetySettings`; vía `onPayload` | CONFIRMADO; la forma del payload queda verificada estáticamente | S3 se reduce al caso de bloqueo en vivo |
| Memory/pgvector inerte | CONFIRMADO estáticamente; runtime **[NO VERIFICADO]** | S8 sigue, con baja prioridad |
| 3 scorers al 100 % | CONFIRMADO | D5 se mantiene |
| Paso 4 bloqueante | CONFIRMADO | Se mantiene por paridad |
| LNA no controla localhost→localhost | PARCIAL: no se lista como exento ni como cubierto | D6 no depende de LNA |
| Edge activa LNA por defecto desde 144 | PARCIAL: la política queda obsoleta tras 144; "por defecto" es inferencia | Impacto bajo |
| Chrome 156 elimina la exención empresarial | **[NO VERIFICADO]** | Sin cambio |
| WebView2 bajo LNA | **[NO VERIFICADO]** | S5 se mantiene |
| `localStorage` de WebView2 no particionado y por usuario de Windows | PARCIAL: "no particionado" confirmado; "por usuario" es inferencia | Sin cambio de diseño |
| 39 tests de paso | REFUTADO: 38 en 7 archivos; `load-author-profile` no tiene tests | Añadir tests de conteo de palabras y 550/800 |
| `B/mastra/index.ts:34` prueba ausencia de datos de producción | DEBILITADO: la línea se refiere al mapa del puente de auth | D12 pasa a decisión del propietario |
| `gpt-5.6-sol` en Pi **[NO VERIFICADO]** | CONFIRMADO en el catálogo (`openai-codex` y `openai`) | S2 se reduce a una llamada en vivo |
| Tolerancia de OpenAI al OAuth de ChatGPT **[NO VERIFICADO]** | CAMBIO MATERIAL: existe SIWC oficial para OSS/local, sobre la Responses API pública | Nueva decisión D13 y nuevo spike S9' |
| Polling 1 s / 3 reintentos del add-in | **[NO VERIFICADO]** en esta ronda | El `HubAdapter` redefine el contrato |

Las consecuencias se concentran en tres puntos. Primero, la referencia de paridad era Codex-direct, pero el producto debería salir por SIWC en la Responses API pública. S7 tiene que medir contra el endpoint con el que se publicará, no contra el que se retira. Segundo, cerrar S4 y rebajar el riesgo de `node:sqlite` deja la persistencia sin incógnitas técnicas relevantes. Tercero, la cifra de 38 tests y la ausencia de tests en `load-author-profile` mueven trabajo de la fase de dominio a escribir tests antes de copiar código.

## Arquitectura, decisiones, riesgos y plan revisados

### Arquitectura objetivo

El Stylistic Hub es una app Electron 44 por usuario de Windows, empaquetada con electron-vite 5.x y electron-builder NSIS per-user.

**Proceso principal.** Gestiona:

- la instancia única, la bandeja y el autoarranque;
- el certificado (`@peculiar/x509`/`selfsigned` + `Import-Certificate`);
- el registro del add-in (`reg.exe` en `Wef\Developer`);
- la UI de login de proveedores, sobre el contrato de dhub y `ModelRuntime.login`, sin OAuth de Anthropic;
- el supervisor propio del backend;
- electron-updater.

**`utilityProcess` `stylistic-backend`.** Recibe `--db=userData/stylistic.db`, `--workflows-db=userData/workflows.db` y `--pi-agent-dir=userData/pi`. Sirve con Hono en `https://localhost:3000`, ligado a `127.0.0.1`:

- el task pane estático, con el token inyectado en el HTML;
- `/api/health`;
- `/api/runs`, `/api/runs/:id` y `/api/runs/:id/cancel`;
- `/api/documents/resolve`;
- `/api/preferences`.

Todas las peticiones pasan por las guardas de peer, `Host`, `Origin` y token.

**Hexágono interno.**

- *Dominio:* prompts, skills, constantes, esquemas zod, normalización y conteo de palabras, copiados al byte.
- *Puerto `WorkflowEngine`:* lo implementa OpenWorkflow; los dos workflows usan los mismos ids de paso.
- *Puerto `LlmGateway`:* lo implementa pi-ai con `structuredCall`, `runWithPool` y `onPayload`.
- *Puerto de repositorios:* lo implementa `node:sqlite`, con las tablas `hub`, `document`, `document_preferences` y `document_style_profile`, sin `workflow_run`.

**Add-in.** Un `HubAdapter` sustituye a `MastraAdapter`/`FeedbackAdapter` detrás del puerto actual, y se retira `@mastra/client-js`.

### Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| D1' | OpenWorkflow tras el puerto `WorkflowEngine` | Runner propio; Mastra (plan B); Effect (plan C) | Herramienta mantenida que cumple las restricciones; el runner propio no pasa el principio |
| D2 | pi-ai directo (`complete`) | `createAgentSession` | Sin herramientas de código ni prompt de sistema ajeno |
| D3 | `structuredCall` con herramienta forzada + `validateToolCall` + zod | Puente AI SDK / `generateObject` | Patrón recomendado por el mantenedor; menos código |
| D4' | Referencia de paridad = modelo `gpt-5.6-sol` medido en el endpoint de publicación | Codex-direct como referencia final | El endpoint sancionado difiere del actual |
| D5 | Sin scorers en línea; evals offline con Vitest | Jueces en cada ejecución | Coste y latencia |
| D6/D7 | Token + guardas; un solo origen HTTPS servido por Hono | Puerto aparte con CORS | Sin cambio; Hono cubre las guardas |
| D8 | `node:sqlite` + SQL directo + runner `user_version` de dhub | Drizzle rc, Kysely + adaptador | Sin ORM estable; riesgo de API ya bajo |
| D9 | Credenciales en el almacén de archivos de Pi; `safeStorage` pospuesto | Cifrado DPAPI propio | Pi es dueño; DPAPI no protege frente al mismo usuario |
| D10 | Claude solo con API key | OAuth Claude.ai | Términos de Anthropic |
| D11' | Fijar `@earendil-works/*` en 1.2.x exacta, todas iguales | 1.0.2 o rangos `^` | 4 versiones en 8 días, dos incompatibles |
| D12' | Datos desde cero, salvo que el propietario confirme datos reales | Migración automática | La evidencia original era débil |
| D13 | Suscripción de ChatGPT vía proveedor `openai` + SIWC, condicionada a S9' y a la licencia o distribución | `openai-codex` (legacy) con el cliente de Codex CLI | Vía sancionada por OpenAI para OSS/local |
| D14 | Certificado con `@peculiar/x509`/`selfsigned` + `Import-Certificate`, CA con nombre propio | `office-addin-dev-certs` | Colisión de nombre de CA, telemetría, validez de 30 días |
| D15 | Registro del add-in escribiendo directamente `Wef\Developer` | `office-addin-dev-settings` | Mismo mecanismo sin dependencias de CLI |
| D16 | Supervisor propio del `utilityProcess` | PM2/forever | Ninguna herramienta lo cubre |

### Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| OpenWorkflow falla en el `utilityProcess` o al cancelar a mitad de paso | Media | Alto | S0; plan B Mastra con `InMemoryStore` tras el mismo puerto |
| OpenWorkflow (pre-1.0, 1,3k estrellas) cambia de API o se abandona | Media | Medio | Versión exacta; puerto `WorkflowEngine`; el pegamento es pequeño y se puede rehacer |
| Latencia de despacho del worker perceptible | Media | Bajo | `worker.tick()` tras encolar; medir en S0 |
| Reanudación durable relanza LLM tras reinicio | Alta si no se gestiona | Medio | Cancelar runs `pending`/`running` al arrancar |
| El modo estricto rechaza los esquemas (`suggestedText` opcional) | Media | Alto | S1; campo requerido y *nullable*; `strict:'prefer'` |
| El login SIWC de Pi no es el flujo OSS sancionado, o Stylistic no es elegible | Media | Alto | S9'; formulario de OpenAI; API key como ruta alternativa |
| Paridad medida en Codex-direct no se traslada a SIWC | Media | Alto | S7 contra el endpoint de publicación |
| Cambios incompatibles de Pi | Alta | Medio | D11'; smoke test por paso |
| El sideloading `Wef\Developer` cambia o muestra avisos | Baja–media | Alto | S5; documentar el riesgo; Marketplace como vía futura |
| El aviso de raíz de Windows o una CA rechazada bloquean la instalación | Media | Medio | Explicar antes; reintento; diagnóstico |
| SmartScreen sin firma o sin elegibilidad para Artifact Signing | Alta | Medio | Decidir la firma antes del lanzamiento público; agrupar releases |
| Carrera de último escritor en el perfil con chunks en paralelo | Alta (ya ocurre) | Medio | Decisión de producto: serializar por documento |
| Dependencia de código privado de dhub sin licencia | Baja | Bajo | Permiso del propietario o reescritura del contrato |

### Spikes

| Spike | Pregunta | Criterio de salida |
|---|---|---|
| **S0** (decisivo) | ¿Funciona OpenWorkflow 0.11.0 + `openworkflow/sqlite` dentro del `utilityProcess` empaquetado de Electron 44? Hay que medir: start, polling a 1 s, cancelación a mitad de una llamada Pi (con `AbortController`), reinicio, `retryPolicy` y latencia de despacho | Los cuatro estados reproducidos; la cancelación aborta la llamada; sin escritura posterior a `canceled` |
| S1 | ¿Aceptan Codex/OpenAI, Gemini 3 y Anthropic API los esquemas `submit_*` estrictos con herramienta forzada? | 20 llamadas por proveedor sin error de validación |
| S2 | ¿Funciona en vivo `gpt-5.6-sol` vía `openai` + SIWC con `toolChoice` de forzado? | Llamada real validada |
| S3 | ¿Cómo aflora en Pi un bloqueo SAFETY de Gemini? | `stopReason` y mensaje registrados |
| S5 | ¿Carga WebView2 de Word el task pane del hub con CA propia y sideload `Wef\Developer`, sin aviso de LNA? | Flujo completo en una instalación limpia |
| S6 | ¿Acepta `ModelRuntime.create` un `AuthStorage` inyectado? | Solo si se reabre D9 |
| S7 | ¿Produce el pipeline nuevo resultados equivalentes a Mastra? | Corpus fijo, comparado en el endpoint de publicación |
| S8 | ¿Confirma el runtime que Mastra Memory está inerte? | Tablas de memoria vacías (baja prioridad) |
| S9' | ¿Usa el login SIWC de Pi el registro dinámico OSS (`ext_agent_host_id`), y qué licencia y distribución tendrá Stylistic? | Lectura de `pi-ai/dist/providers/openai*.js` + decisión del propietario |
| S10 | ¿Firma `selfsigned` una hoja con CA propia, o hace falta `@peculiar/x509`? ¿Qué aviso muestra Windows 11? | Certificado instalado y confiado por WebView2 |
| S11 | ¿Qué forma tiene la API HTTPS de `serve()` en `@hono/node-server` 2.x? | Servidor TLS en 127.0.0.1 |

S4 queda cerrado y S9 se sustituye por S9'.

### Plan por fases

| Fase | Contenido | Salida verificable |
|---|---|---|
| 0 | S0, S1, S2, S9' y S11 | D1', D3, D4' y D13 confirmadas o revisadas |
| 1. Dominio | Copia al byte; portar los 38 tests; añadir tests de `load-author-profile` (conteo, 550/800) y de upsert | Golden tests en verde sin Mastra |
| 2. Persistencia | 4 tablas, runner `user_version` reutilizado, repositorios `node:sqlite` | Tests de upsert y CHECK sobre `:memory:` |
| 3. Gateway LLM | Pi 1.2.x fijado, `structuredCall`, `runWithPool`, `onPayload`, `ModelRuntime.create` | Tests con proveedor falso + llamada real |
| 4. Workflows y API | OpenWorkflow con los dos workflows, pegamento de cancelación y estados, Hono + guardas + token | Test e2e start → poll → success/failed/canceled |
| 5. Shell mínimo | Electron: instancia única, `utilityProcess`, certificado, registro del add-in, UI de login | S5 y S10 superados |
| 6. Add-in | `HubAdapter`; retirar auth, `OfficeDialogAuthAdapter` y `@mastra/client-js` | Flujo MVP en Word |
| 7. Endurecimiento | Supervisor, logs, backups/exportación, bandeja y autoarranque, electron-updater, firma | Instalación y actualización limpias |
| 8. Retirada | Eliminar Better Auth, `pg`, `@mastra/*`, DuckDB, pgvector y Docker; S7 | Comparación aceptada |
| 9. Opcional | Pools `metered` completos + S3; evals offline; serializar el perfil; reevaluar pi-durable y Drizzle 1.0 | Decisiones registradas |

### Alcance del MVP

El MVP es la porción mínima de extremo a extremo, es decir, las fases 0 a 6 recortadas.

**Qué incluye:**

- **Instalar el hub:** NSIS per-user sin firmar, aceptando el aviso de SmartScreen en pruebas. El hub instala su propia CA en `CurrentUser\Root` y registra el manifiesto XML en `Wef\Developer`.
- **Conectar un proveedor:** un único proveedor elegido en la UI de login de Pi. Lo mínimo es API key de OpenAI o de Gemini, y se añade SIWC si S9' pasa. El OAuth de Anthropic queda oculto.
- **Instalar el add-in en Word:** Word lo carga desde el hub en `https://localhost:3000`.
- **Analizar un documento:** `stylistic-workflow` corre en OpenWorkflow con un solo modelo, sin pool.
- **Ver las sugerencias como control de cambios:** se reutiliza la ruta actual del add-in tras el `HubAdapter`.
- **Dar feedback:** `feedback-workflow` actualiza el perfil.

**Qué queda fuera:** pools y fallback, `safetySettings`, auto-update, firma, backups/exportación, bandeja/autoarranque, supervisor con backoff (basta un reinicio simple), evals y migración de datos.

El MVP valida a la vez las tres incógnitas que pueden tumbar la arquitectura: el motor (S0), la salida estructurada (S1) y la carga en WebView2 (S5).

## Conclusión

Aplicar el principio con rigor cambió la pregunta. Ya no es "qué construimos encima de Pi", sino "qué decidieron no construir las herramientas que adoptamos". Hay que distinguir entre una herramienta que todavía no existe y una funcionalidad que una herramienta rechazó a propósito. El runner de workflows estaba en el primer caso, y apareció una herramienta: OpenWorkflow integró `node:sqlite` en su núcleo y deprecó el paquete separado. La salida estructurada y el fallback de Pi están en el segundo caso. Ahí el pegamento propio no contradice el principio: es la forma de uso que el propio mantenedor indica. Es una prueba útil para futuras decisiones. Cuando un mantenedor cierra una petición como *not planned* con un patrón alternativo, ese patrón es la herramienta.

El riesgo dominante también cambió de sitio. Con casi toda la fontanería adoptada y la persistencia sin incógnitas, lo que más condiciona el producto es la naturaleza de Stylistic: si es abierto o cerrado, gratuito o de pago, local o alojado. Esa decisión, que no es técnica, determina el proveedor de suscripción, el endpoint de referencia para la paridad y si el sideload sin tenant es aceptable o hay que ir a Marketplace. Conviene tomarla antes de la fase 3, porque es la única entrada del plan que ningún spike puede resolver.
