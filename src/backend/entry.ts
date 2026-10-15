import { createServer } from 'node:https'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { SERVER_VERSION } from '../shared/versions'
import { createHttpApp } from './adapters/http/app'
import { createOpenWorkflowEngine } from './adapters/openworkflow/engine'
import { createPiLlm } from './adapters/pi/pi-llm'
import { createChosenModel } from './adapters/pi/pi-runtime'
import { openDatabase } from './adapters/sqlite/database'
import { SqliteDocumentRepository } from './adapters/sqlite/document-repository'
import { SqlitePreferencesRepository } from './adapters/sqlite/preferences-repository'
import { ensureCertificates } from './adapters/tls/certificates'
import { STYLISTIC_WORKFLOW_ID, stylisticWorkflow } from './correction/stylistic-workflow'

/** Arguments the main process passes when it forks this utility process. */
const { values } = parseArgs({
  options: {
    certs: { type: 'string' },
    db: { type: 'string' },
    pi: { type: 'string' },
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
/** Workflow bodies by the id the add-in uses. */
const workflows = {
  [STYLISTIC_WORKFLOW_ID]: stylisticWorkflow({
    llm,
    documents: new SqliteDocumentRepository(db),
    correctionInstructions: async () => preferences.getCorrectionInstructions() ?? undefined
  })
}
/** Durable runs in OpenWorkflow's own file next to the hub database. */
const engine = await createOpenWorkflowEngine({ file: join(dirname(values.db), 'workflows.db'), workflows })
/** The HTTP surface both listeners serve. */
const app = createHttpApp({
  token,
  port,
  serverVersion: SERVER_VERSION,
  engine,
  workflows: Object.keys(workflows),
  preferences
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
