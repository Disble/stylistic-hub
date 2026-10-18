import { createServer } from 'node:https'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { SERVER_VERSION } from '../shared/versions'
import { createAnalysisService } from './analysis/analysis-service'
import {
  ANALYSIS_WORKFLOW,
  analysisWorkflow,
  analyzePartWorkflow,
  PART_WORKFLOW,
  PROFILE_WORKFLOW,
  updateProfileWorkflow
} from './analysis/analysis-workflow'
import { createHttpApp } from './adapters/http/app'
import { createOpenWorkflowEngine } from './adapters/openworkflow/engine'
import { createPiLlm } from './adapters/pi/pi-llm'
import { createChosenModel } from './adapters/pi/pi-runtime'
import { SqliteAnalysisRepository } from './adapters/sqlite/analysis-repository'
import { openDatabase } from './adapters/sqlite/database'
import { SqliteDocumentRepository } from './adapters/sqlite/document-repository'
import { SqliteFeedbackRepository } from './adapters/sqlite/feedback-repository'
import { SqlitePreferencesRepository } from './adapters/sqlite/preferences-repository'
import { ensureCertificates } from './adapters/tls/certificates'
import { createFeedbackService } from './feedback/feedback-service'
import {
  FEEDBACK_WORKFLOW,
  feedbackWorkflow,
  PROCESS_FEEDBACK_WORKFLOW,
  processFeedbackWorkflow
} from './feedback/feedback-workflow'
import { loadModules, type ServedModule } from './modules'
import { createProfileUpdater } from './profile/profile-updater'

/** Arguments the main process passes when it forks this utility process. */
const { values } = parseArgs({
  options: {
    certs: { type: 'string' },
    db: { type: 'string' },
    pi: { type: 'string' },
    // Optional: without it the hub serves only the API.
    addin: { type: 'string' },
    port: { type: 'string' }
  },
  strict: true
})

/** The hub token arrives through the environment so it never shows in a process listing. */
const token = process.env['STYLISTIC_HUB_TOKEN']
// Child processes the backend starts later (Pi tools, for instance) must not inherit it.
delete process.env['STYLISTIC_HUB_TOKEN']

if (!values.certs || !values.db || !values.pi || !values.port || !token) {
  console.error('backend: missing --certs, --db, --pi, --port or STYLISTIC_HUB_TOKEN')
  process.exit(2)
}

/** Modules to serve at `/m/<id>/`, from the environment: older servers would exit on a new flag. */
let modules: ServedModule[]
try {
  modules = loadModules(process.env['STYLISTIC_MODULES'])
} catch (error) {
  console.error(`backend: ${(error as Error).message}`)
  process.exit(2)
}

/** Port shared by the task pane and the API. */
const port = Number(values.port)
/** The hub database, migrated before any request; the workflows keep it open. */
const db = openDatabase(values.db)
/** Pi over the directory the main process signs in to. */
const pi = await createChosenModel(values.pi)
/** Structured calls to the model chosen on the Provider screen. */
const llm = createPiLlm({ complete: (m, c, o) => pi.runtime.complete(m, c, o), getModel: pi.getModel })

/** TLS material for the HTTPS listeners. */
const { key, cert } = await ensureCertificates(values.certs)
/** The user's correction preferences, edited from the add-in's settings. */
const preferences = new SqlitePreferencesRepository(db)
/** Document contexts and their style profiles. */
const documents = new SqliteDocumentRepository(db)
/** Analyses, their chunks and suggestions. */
const analyses = new SqliteAnalysisRepository(db)
/** Feedback on suggestions. */
const feedback = new SqliteFeedbackRepository(db)
/** Profile writes, one at a time per document. */
const profile = createProfileUpdater(documents)
/** What the analysis workflows need. */
const analysisDeps = {
  llm,
  documents,
  analyses,
  profile,
  correctionInstructions: async () => preferences.getCorrectionInstructions() ?? undefined
}
/** What the feedback workflows need. */
const feedbackDeps = { llm, analyses, feedback, profile }
/** Durable runs in OpenWorkflow's own file next to the hub database. */
const engine = await createOpenWorkflowEngine({
  file: join(dirname(values.db), 'workflows.db'),
  workflows: {
    [ANALYSIS_WORKFLOW]: analysisWorkflow(analysisDeps),
    [PART_WORKFLOW]: analyzePartWorkflow(analysisDeps),
    [PROFILE_WORKFLOW]: updateProfileWorkflow(analysisDeps),
    [FEEDBACK_WORKFLOW]: feedbackWorkflow(feedbackDeps),
    [PROCESS_FEEDBACK_WORKFLOW]: processFeedbackWorkflow(feedbackDeps)
  }
})
/** The HTTP surface both listeners serve. */
const app = createHttpApp({
  token,
  port,
  serverVersion: SERVER_VERSION,
  analyses: createAnalysisService({
    documents,
    analyses,
    engine,
    model: async () => {
      const model = await pi.getModel()
      return model && { provider: model.provider, id: model.id, name: model.name }
    }
  }),
  feedback: createFeedbackService({ analyses, feedback, engine }),
  documents,
  preferences,
  addinDir: values.addin,
  modules
})

// Listen on both loopback addresses and nothing else: `localhost` may resolve to either.
for (const hostname of ['127.0.0.1', '::1']) {
  const server = serve({ fetch: app.fetch, port, hostname, createServer, serverOptions: { key, cert } })
  server.on('error', (error: NodeJS.ErrnoException) => {
    // A machine without IPv6 loopback still serves on 127.0.0.1.
    if (hostname === '::1' && error.code === 'EADDRNOTAVAIL') return
    console.error(`backend: cannot listen on ${hostname}:${port}: ${error.message}`)
    process.exit(1)
  })
}

console.log(`backend ${SERVER_VERSION} listening on https://localhost:${port}`)
