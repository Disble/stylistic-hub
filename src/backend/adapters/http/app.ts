import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { ipRestriction } from 'hono/ip-restriction'
import { secureHeaders } from 'hono/secure-headers'
import { addinRoutes } from './addin-routes'
import { apiV1, type ApiV1Options } from './api-v1'
import { hostAllowlist } from './host-allowlist'
import { problem } from './problem'

/** What the HTTP adapter needs from the composition root. */
export interface HttpAppOptions extends ApiV1Options {
  /** Per-install secret the task pane sends as a bearer token. */
  token: string
  /** Port the task pane and the API share, fixed by the add-in manifest. */
  port: number
  /** stylistic-addon's build, served at the root when given. */
  addinDir?: string | undefined
  /** Modules, each served at `/m/<id>/` like the add-in at the root. */
  modules: readonly { id: string; dir: string; version: string }[]
}

/** Loopback peers, including the IPv4-mapped form Node reports on dual-stack sockets. */
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1']

/**
 * Builds the hub's HTTP surface. Every request must come from loopback with one of our Host
 * names; the API also requires the task pane's origin for CORS and the hub token, and answers
 * every error it can as `application/problem+json`.
 */
export function createHttpApp({ token, port, addinDir, modules, ...api }: HttpAppOptions): Hono {
  const app = new Hono()

  app.use(hostAllowlist([`localhost:${port}`, `127.0.0.1:${port}`]))
  app.use(ipRestriction(getConnInfo, { allowList: LOOPBACK }))
  // No HSTS: it is per host, not per port, so it would force HTTPS on the user's other localhost servers.
  app.use(secureHeaders({ strictTransportSecurity: false }))
  app.use('/api/*', cors({ origin: `https://localhost:${port}` }))
  app.use('/api/*', bearerAuth({ token }))

  app.route('/api/v1', apiV1({ ...api, modules }))
  app.notFound((c) =>
    c.req.path.startsWith('/api/') || c.req.path.startsWith('/m/')
      ? problem(c, 404, 'not_found', `No route ${c.req.method} ${c.req.path}.`)
      : c.text('Not found', 404)
  )
  app.onError((error, c) => {
    // bearerAuth answers a malformed header (an empty token, another scheme) with 400 and a
    // challenge; to the task pane that is a missing token, like its 401.
    if (
      error instanceof HTTPException &&
      (error.status === 401 || error.res?.headers.has('WWW-Authenticate'))
    ) {
      return problem(c, 401, 'unauthorized', 'Send the hub token as "Authorization: Bearer <token>".')
    }
    // Hono's own refusals before validation: malformed JSON (400), a body that is not JSON (415).
    if (error instanceof HTTPException && error.status < 500) {
      return problem(c, error.status, 'validation_failed', error.message)
    }
    console.error(error)
    return problem(c, 500, 'internal_error', error.message)
  })
  // Registered last: the API paths above never fall through to the add-in's files.
  for (const { id, dir } of modules) app.route(`/m/${id}`, addinRoutes({ dir, token, mount: `/m/${id}` }))
  if (addinDir) app.route('/', addinRoutes({ dir: addinDir, token }))

  return app
}
