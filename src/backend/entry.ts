import { createServer } from 'node:https'
import { parseArgs } from 'node:util'
import { serve } from '@hono/node-server'
import { SERVER_VERSION } from '../shared/versions'
import { createHttpApp } from './adapters/http/app'
import { ensureCertificates } from './adapters/tls/certificates'

/** Arguments the main process passes when it forks this utility process. */
const { values } = parseArgs({
  options: { certs: { type: 'string' }, port: { type: 'string' } },
  strict: true
})

/** The hub token arrives through the environment so it never shows in a process listing. */
const token = process.env['STYLISTIC_HUB_TOKEN']
// Child processes the backend starts later (Pi tools, for instance) must not inherit it.
delete process.env['STYLISTIC_HUB_TOKEN']

if (!values.certs || !values.port || !token) {
  console.error('backend: missing --certs, --port or STYLISTIC_HUB_TOKEN')
  process.exit(2)
}

/** Port shared by the task pane and the API. */
const port = Number(values.port)
/** TLS material for the HTTPS listeners. */
const { key, cert } = await ensureCertificates(values.certs)
/** The HTTP surface both listeners serve. */
const app = createHttpApp({ token, port, serverVersion: SERVER_VERSION })

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
