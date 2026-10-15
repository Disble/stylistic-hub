import { describe, expect, it } from 'vitest'
import { createHttpApp } from './app'

/** Token the app under test expects. */
const token = 'a'.repeat(64)
/** Port the app under test serves on. */
const port = 3000
/** The app under test. */
const app = createHttpApp({
  token,
  port,
  serverVersion: '0.0.1',
  engine: { start: async () => 'run', get: async () => undefined, cancel: async () => {} },
  workflows: ['stylistic-workflow']
})

/** Simulates the TCP peer @hono/node-server exposes to getConnInfo. */
function fromPeer(remoteAddress: string) {
  return {
    incoming: {
      socket: {
        remoteAddress,
        remotePort: 51000,
        remoteFamily: remoteAddress.includes(':') ? 'IPv6' : 'IPv4'
      }
    }
  }
}

/** A request from the task pane: right host, origin and token, from loopback. */
function health(headers: Record<string, string> = {}, peer = '127.0.0.1') {
  return app.request(
    '/api/health',
    {
      headers: {
        host: `localhost:${port}`,
        origin: `https://localhost:${port}`,
        authorization: `Bearer ${token}`,
        ...headers
      }
    },
    fromPeer(peer)
  )
}

describe('createHttpApp', () => {
  it('answers health with the server version for a trusted request', async () => {
    const response = await health()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', version: '0.0.1' })
  })

  it('accepts 127.0.0.1 as the host too', async () => {
    expect((await health({ host: `127.0.0.1:${port}` })).status).toBe(200)
  })

  it('rejects a foreign Host header, which is how DNS rebinding arrives', async () => {
    const response = await health({ host: `evil.example:${port}` })

    expect(response.status).toBe(403)
  })

  it('rejects the right host name on another port', async () => {
    expect((await health({ host: 'localhost:4000' })).status).toBe(403)
  })

  it('rejects a peer that is not loopback', async () => {
    expect((await health({}, '192.168.1.20')).status).toBe(403)
  })

  it('accepts the IPv6 loopback peer', async () => {
    expect((await health({}, '::1')).status).toBe(200)
  })

  it('requires the hub token on the API', async () => {
    const missing = await health({ authorization: '' })
    const wrong = await health({ authorization: `Bearer ${'b'.repeat(64)}` })

    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
  })

  it('only grants CORS to the task pane origin', async () => {
    const trusted = await health()
    const foreign = await health({ origin: 'https://evil.example' })

    expect(trusted.headers.get('access-control-allow-origin')).toBe(`https://localhost:${port}`)
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sends secure headers', async () => {
    const response = await health()

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('rejects a request without a Host header', async () => {
    const response = await app.request(
      '/api/health',
      { headers: { authorization: `Bearer ${token}` } },
      fromPeer('127.0.0.1')
    )

    expect(response.status).toBe(403)
  })

  it('rejects a trailing-dot host name', async () => {
    expect((await health({ host: `localhost.:${port}` })).status).toBe(403)
  })

  it('accepts the IPv4-mapped loopback peer of a dual-stack socket', async () => {
    expect((await health({}, '::ffff:127.0.0.1')).status).toBe(200)
  })

  it('answers the CORS preflight of the task pane without a token', async () => {
    const response = await app.request(
      '/api/health',
      {
        method: 'OPTIONS',
        headers: {
          host: `localhost:${port}`,
          origin: `https://localhost:${port}`,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization'
        }
      },
      fromPeer('127.0.0.1')
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(`https://localhost:${port}`)
  })

  it('serves the workflow API behind the same guards', async () => {
    const trusted = { host: `localhost:${port}`, origin: `https://localhost:${port}` }

    const withToken = await app.request(
      '/api/workflows/stylistic-workflow',
      { headers: { ...trusted, authorization: `Bearer ${token}` } },
      fromPeer('127.0.0.1')
    )
    const withoutToken = await app.request(
      '/api/workflows/stylistic-workflow',
      { headers: trusted },
      fromPeer('127.0.0.1')
    )

    expect(withToken.status).toBe(200)
    expect(withoutToken.status).toBe(401)
  })
})
