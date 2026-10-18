import { createHmac } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createAnalysisService } from '../../analysis/analysis-service'
import { createFeedbackService } from '../../feedback/feedback-service'
import type { WorkflowEngine } from '../../ports/workflow-engine'
import { SqliteAnalysisRepository } from '../sqlite/analysis-repository'
import { openDatabase } from '../sqlite/database'
import { SqliteDocumentRepository } from '../sqlite/document-repository'
import { SqliteFeedbackRepository } from '../sqlite/feedback-repository'
import { SqlitePreferencesRepository } from '../sqlite/preferences-repository'
import { createHttpApp } from './app'

/** Token the app under test expects. */
const token = 'a'.repeat(64)
/** A module's token as the hub derives it: HMAC-SHA256 of "module:<id>" keyed by the hub token. */
const moduleToken = (id: string) => createHmac('sha256', token).update(`module:${id}`).digest('hex')
/** Port the app under test serves on. */
const port = 3000
/** The API's dependencies over an in-memory database and an engine that runs nothing. */
function services() {
  const db = openDatabase(':memory:')
  const documents = new SqliteDocumentRepository(db)
  const analyses = new SqliteAnalysisRepository(db)
  const engine: WorkflowEngine = {
    start: async () => 'run',
    get: async () => undefined,
    cancel: async () => {}
  }
  return {
    serverVersion: '0.0.1',
    analyses: createAnalysisService({
      documents,
      analyses,
      engine,
      model: async () => ({ provider: 'opencode-go', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' })
    }),
    feedback: createFeedbackService({ analyses, feedback: new SqliteFeedbackRepository(db), engine }),
    documents,
    preferences: new SqlitePreferencesRepository(db),
    modules: []
  }
}

/** The app under test. */
const app = createHttpApp({ token, port, ...services() })

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
    '/api/v1/status',
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
  it('answers the status with the server version for a trusted request', async () => {
    const response = await health()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ version: '0.0.1', analysis: { ready: true } })
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
    expect(wrong.headers.get('content-type')).toBe('application/problem+json')
    expect(await wrong.json()).toEqual({
      type: 'urn:stylistic:problem:unauthorized',
      title: 'The hub token is missing or wrong',
      status: 401,
      detail: 'Send the hub token as "Authorization: Bearer <token>".',
      code: 'unauthorized'
    })
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

  it('sends no HSTS, which would force HTTPS on every localhost port in the browser', async () => {
    const response = await health()

    expect(response.headers.get('strict-transport-security')).toBeNull()
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
      '/api/v1/status',
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

  it.each([
    ['an empty bearer token', { authorization: 'Bearer ' }, 401, 'unauthorized'],
    ['another authorization scheme', { authorization: 'Basic abc' }, 401, 'unauthorized']
  ])('answers %s with a JSON problem', async (_case, headers, status, code) => {
    const response = await health(headers)

    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toMatchObject({ status, code })
  })

  it.each([
    ['malformed JSON', 'application/json', '{"genre":', 400, 'Malformed JSON in request body'],
    ['a body that is not JSON', 'text/plain', 'hola', 415, 'Unsupported Media Type']
  ])('answers %s with a validation_failed problem', async (_case, type, body, status, detail) => {
    const response = await app.request(
      '/api/v1/documents/3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b/analyses',
      {
        method: 'POST',
        headers: {
          host: `localhost:${port}`,
          origin: `https://localhost:${port}`,
          authorization: `Bearer ${token}`,
          'content-type': type
        },
        body
      },
      fromPeer('127.0.0.1')
    )

    expect(response.status).toBe(status)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toMatchObject({ status, code: 'validation_failed', detail })
  })

  it('answers an API route that does not exist with a not_found problem', async () => {
    const response = await app.request(
      '/api/workflows/stylistic-workflow',
      {
        headers: {
          host: `localhost:${port}`,
          origin: `https://localhost:${port}`,
          authorization: `Bearer ${token}`
        }
      },
      fromPeer('127.0.0.1')
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      code: 'not_found',
      detail: 'No route GET /api/workflows/stylistic-workflow.'
    })
  })

  it('serves the task pane without a token but only to our Host', async () => {
    const addinDir = mkdtempSync(join(tmpdir(), 'hub-app-addin-'))
    writeFileSync(join(addinDir, 'taskpane.html'), '<html><head></head></html>')
    const withAddin = createHttpApp({ token, port, ...services(), addinDir })

    const page = await withAddin.request(
      '/taskpane.html',
      { headers: { host: `localhost:${port}` } },
      fromPeer('127.0.0.1')
    )
    const foreign = await withAddin.request(
      '/taskpane.html',
      { headers: { host: 'evil.test' } },
      fromPeer('127.0.0.1')
    )
    const api = await withAddin.request(
      '/api/health',
      { headers: { host: `localhost:${port}` } },
      fromPeer('127.0.0.1')
    )

    expect(page.status).toBe(200)
    expect(await page.text()).toContain(token)
    expect(foreign.status).toBe(403)
    expect(api.status).toBe(401)
    rmSync(addinDir, { recursive: true, force: true })
  })

  it('serves each module under /m/<id>/ beside the add-in at the root, and lists the modules on the API', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hub-app-modules-'))
    const addinDir = join(root, 'addin')
    const moduleDir = join(root, 'module')
    mkdirSync(addinDir)
    mkdirSync(moduleDir)
    writeFileSync(join(addinDir, 'taskpane.html'), '<html><head><title>root</title></head></html>')
    writeFileSync(join(moduleDir, 'taskpane.html'), '<html><head><title>module</title></head></html>')
    const withModules = createHttpApp({
      token,
      port,
      ...services(),
      addinDir,
      modules: [{ id: 'stylistic-addon', dir: moduleDir, version: '1.2.3.0', scopes: ['modules'] }]
    })
    const get = (path: string, headers: Record<string, string> = {}) =>
      withModules.request(path, { headers: { host: `localhost:${port}`, ...headers } }, fromPeer('127.0.0.1'))

    const modulePage = await get('/m/stylistic-addon/taskpane.html')
    const rootPage = await get('/taskpane.html')
    const unknown = await get('/m/other/taskpane.html')
    const listed = await get('/api/v1/modules', { authorization: `Bearer ${token}` })
    const refused = await get('/api/v1/modules')

    expect(modulePage.status).toBe(200)
    const moduleHtml = await modulePage.text()
    expect(moduleHtml).toContain(
      `<title>module</title><meta name="stylistic-hub-token" content="${moduleToken('stylistic-addon')}">`
    )
    expect(moduleHtml).not.toContain(token)
    expect(await rootPage.text()).toContain(
      `<title>root</title><meta name="stylistic-hub-token" content="${token}">`
    )
    expect(unknown.status).toBe(404)
    expect(unknown.headers.get('content-type')).toBe('application/problem+json')
    expect(await unknown.json()).toMatchObject({
      code: 'not_found',
      detail: 'No route GET /m/other/taskpane.html.'
    })
    expect(await listed.json()).toEqual({ modules: [{ id: 'stylistic-addon', version: '1.2.3.0' }] })
    expect(refused.status).toBe(401)
    rmSync(root, { recursive: true, force: true })
  })

  describe('module tokens', () => {
    /** Two modules: one may read the status and run analyses, the other may only list modules. */
    const scoped = createHttpApp({
      token,
      port,
      ...services(),
      modules: [
        { id: 'module-a', dir: tmpdir(), version: '1.0.0.0', scopes: ['status', 'analyses'] },
        { id: 'module-b', dir: tmpdir(), version: '1.0.0.0', scopes: ['modules'] }
      ]
    })
    /** A request to the API with `bearer`, from the task pane. */
    const call = (path: string, bearer: string, init: RequestInit = {}) =>
      scoped.request(
        path,
        {
          ...init,
          headers: {
            host: `localhost:${port}`,
            origin: `https://localhost:${port}`,
            authorization: `Bearer ${bearer}`,
            'content-type': 'application/json'
          }
        },
        fromPeer('127.0.0.1')
      )
    const documentId = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'

    it('accepts a module token on a scope the module declared', async () => {
      const status = await call('/api/v1/status', moduleToken('module-a'))
      const analysis = await call(`/api/v1/documents/${documentId}/analyses`, moduleToken('module-a'), {
        method: 'POST',
        body: JSON.stringify({ genre: 'narrativa-literaria', chunks: [{ id: 'c1', text: 'Hola.' }] })
      })

      expect(status.status).toBe(200)
      expect(analysis.status).toBe(202)
    })

    it.each([
      ['the documents scope', '/api/v1/documents/3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'],
      ['the preferences scope', '/api/v1/preferences'],
      ['the modules scope', '/api/v1/modules'],
      ['the feedback scope', '/api/v1/feedback/3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'],
      ['the OpenAPI document, which is in no scope', '/api/v1/openapi.json'],
      ['a path outside API v1', '/api/health']
    ])(
      'refuses a module token on %s it did not declare with the unauthorized problem',
      async (_case, path) => {
        const response = await call(path, moduleToken('module-a'))

        expect(response.status).toBe(401)
        expect(response.headers.get('content-type')).toBe('application/problem+json')
        expect(await response.json()).toEqual({
          type: 'urn:stylistic:problem:unauthorized',
          title: 'The hub token is missing or wrong',
          status: 401,
          detail: 'Send the hub token as "Authorization: Bearer <token>".',
          code: 'unauthorized'
        })
      }
    )

    it("does not take one module's token for another's scopes", async () => {
      expect((await call('/api/v1/modules', moduleToken('module-b'))).status).toBe(200)
      expect((await call('/api/v1/modules', moduleToken('module-a'))).status).toBe(401)
      expect((await call('/api/v1/status', moduleToken('module-b'))).status).toBe(401)
    })

    it('refuses the token of a module the hub does not serve', async () => {
      expect((await call('/api/v1/status', moduleToken('module-c'))).status).toBe(401)
    })

    it('lets the hub token through every scope', async () => {
      for (const path of [
        '/api/v1/status',
        '/api/v1/modules',
        '/api/v1/preferences',
        '/api/v1/openapi.json'
      ]) {
        expect((await call(path, token)).status).toBe(200)
      }
    })
  })
})
