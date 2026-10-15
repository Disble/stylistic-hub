import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addinRoutes } from './addin-routes'

/** Temp folder holding the built add-in and a file just outside it. */
let root: string
/** A built add-in, as webpack writes it. */
let dir: string
/** The hub token the task pane needs. */
const token = 'b'.repeat(64)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-addin-'))
  dir = join(root, 'dist')
  mkdirSync(dir)
  writeFileSync(
    join(dir, 'taskpane.html'),
    '<!doctype html><html><head><title>Stylistic</title></head><body></body></html>'
  )
  writeFileSync(join(dir, 'taskpane.js'), 'console.log(1)')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'icon-32.png'), 'png')
  writeFileSync(join(root, 'hub-addin-secret.txt'), 'secret')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('addinRoutes', () => {
  it('serves the task pane with the hub token in it, never cached', async () => {
    const response = await addinRoutes({ dir, token }).request('/taskpane.html')

    const html = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/text\/html/)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(html).toContain(`<meta name="stylistic-hub-token" content="${token}"></head>`)
    expect(html).toContain('<title>Stylistic</title>')
  })

  it('serves the rest of the built add-in as it is', async () => {
    const routes = addinRoutes({ dir, token })

    const script = await routes.request('/taskpane.js')
    const icon = await routes.request('/assets/icon-32.png')

    expect(await script.text()).toBe('console.log(1)')
    expect(script.headers.get('content-type')).toMatch(/javascript/)
    expect(icon.headers.get('content-type')).toBe('image/png')
  })

  it('serves nothing outside the add-in folder', async () => {
    const routes = addinRoutes({ dir, token })

    expect((await routes.request('/../hub-addin-secret.txt')).status).toBe(404)
    expect((await routes.request('/%2e%2e/hub-addin-secret.txt')).status).toBe(404)
    expect((await routes.request('/missing.js')).status).toBe(404)
  })

  it('fails instead of serving a task pane without the token', async () => {
    writeFileSync(join(dir, 'taskpane.html'), '<html><body></body></html>')

    const response = await addinRoutes({ dir, token }).request('/taskpane.html')

    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(token)
  })
})
