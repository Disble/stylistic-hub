import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import { ipRestriction } from 'hono/ip-restriction'
import { secureHeaders } from 'hono/secure-headers'
import type { SqlitePreferencesRepository } from '../sqlite/preferences-repository'
import type { WorkflowEngine } from '../../ports/workflow-engine'
import { hostAllowlist } from './host-allowlist'
import { preferencesRoutes } from './preferences-routes'
import { workflowRoutes } from './workflow-routes'

/** What the HTTP adapter needs from the composition root. */
export interface HttpAppOptions {
  /** Per-install secret the task pane sends as a bearer token. */
  token: string
  /** Port the task pane and the API share, fixed by the add-in manifest. */
  port: number
  /** Version of the local server component, reported by `/api/health`. */
  serverVersion: string
  /** Runs the workflows the task pane starts and polls. */
  engine: WorkflowEngine
  /** Ids of the workflows it runs, as the add-in names them. */
  workflows: string[]
  preferences: SqlitePreferencesRepository
}

/** Loopback peers, including the IPv4-mapped form Node reports on dual-stack sockets. */
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/**
 * Builds the hub's HTTP surface. Every request must come from loopback with one of our Host
 * names; the API also requires the task pane's origin for CORS and the hub token.
 */
export function createHttpApp({
  token,
  port,
  serverVersion,
  engine,
  workflows,
  preferences
}: HttpAppOptions): Hono {
  const app = new Hono()

  app.use(hostAllowlist([`localhost:${port}`, `127.0.0.1:${port}`]))
  app.use(ipRestriction(getConnInfo, { allowList: LOOPBACK }))
  // No HSTS: it is per host, not per port, so it would force HTTPS on the user's other localhost servers.
  app.use(secureHeaders({ strictTransportSecurity: false }))
  // stylistics-backend served preferences outside `/api`; the add-in keeps that path.
  for (const path of ['/api/*', '/user/*']) {
    app.use(path, cors({ origin: `https://localhost:${port}` }))
    app.use(path, bearerAuth({ token }))
  }

  app.get('/api/health', (c) => c.json({ status: 'ok', version: serverVersion }))
  app.route('/api/workflows', workflowRoutes(engine, workflows))
  app.route('/user/preferences', preferencesRoutes(preferences))

  return app
}
