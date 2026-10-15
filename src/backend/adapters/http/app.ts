import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import { ipRestriction } from 'hono/ip-restriction'
import { secureHeaders } from 'hono/secure-headers'
import { hostAllowlist } from './host-allowlist'

/** What the HTTP adapter needs from the composition root. */
export interface HttpAppOptions {
  /** Per-install secret the task pane sends as a bearer token. */
  token: string
  /** Port the task pane and the API share, fixed by the add-in manifest. */
  port: number
  /** Version of the local server component, reported by `/api/health`. */
  serverVersion: string
}

/** Loopback peers, including the IPv4-mapped form Node reports on dual-stack sockets. */
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/**
 * Builds the hub's HTTP surface. Every request must come from loopback with one of our Host
 * names; the API also requires the task pane's origin for CORS and the hub token.
 */
export function createHttpApp({ token, port, serverVersion }: HttpAppOptions): Hono {
  const app = new Hono()

  app.use(hostAllowlist([`localhost:${port}`, `127.0.0.1:${port}`]))
  app.use(ipRestriction(getConnInfo, { allowList: LOOPBACK }))
  app.use(secureHeaders())
  app.use('/api/*', cors({ origin: `https://localhost:${port}` }))
  app.use('/api/*', bearerAuth({ token }))

  app.get('/api/health', (c) => c.json({ status: 'ok', version: serverVersion }))

  return app
}
