import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addinRoutes, HOST_BRIDGE_GUARD } from './addin-routes'

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

  it('puts the host bridge guard first in the head, before Office.js runs', async () => {
    writeFileSync(
      join(dir, 'taskpane.html'),
      '<html><head><meta charset="UTF-8"/>' +
        '<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script></head></html>'
    )

    const html = await (await addinRoutes({ dir, token }).request('/taskpane.html')).text()

    expect(html).toContain(`<head><script>${HOST_BRIDGE_GUARD}</script><meta charset="UTF-8"/>`)
  })

  it('serves the rest of the built add-in as it is', async () => {
    const routes = addinRoutes({ dir, token })

    const script = await routes.request('/taskpane.js')
    const icon = await routes.request('/assets/icon-32.png')

    expect(await script.text()).toBe('console.log(1)')
    expect(script.headers.get('content-type')).toMatch(/javascript/)
    expect(icon.headers.get('content-type')).toBe('image/png')
  })

  it('makes Word ask for every file of the add-in again instead of reusing its copy', async () => {
    const response = await addinRoutes({ dir, token }).request('/taskpane.js')

    expect(response.headers.get('cache-control')).toBe('no-cache')
  })

  it("points the task pane at this build's own scripts and styles, so a copy Word cached from another build is never run", async () => {
    writeFileSync(
      join(dir, 'taskpane.html'),
      '<html><head><script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>' +
        '<link href="taskpane.css" rel="stylesheet" /><script defer src="taskpane.js"></script></head></html>'
    )
    writeFileSync(join(dir, 'taskpane.css'), 'body{}')
    const routes = addinRoutes({ dir, token })
    const versioned = async (): Promise<string[]> =>
      [...(await (await routes.request('/taskpane.html')).text()).matchAll(/(?:src|href)="([^"]+)"/g)].map(
        (match) => match[1] ?? ''
      )

    const before = await versioned()
    utimesSync(join(dir, 'taskpane.js'), new Date(2030, 0, 1), new Date(2030, 0, 1))
    const after = await versioned()

    expect(before[0]).toBe('https://appsforoffice.microsoft.com/lib/1/hosted/office.js')
    expect(before[1]).toMatch(/^taskpane\.css\?v=\w+$/)
    expect(before[2]).toMatch(/^taskpane\.js\?v=\w+$/)
    expect(after[1]).toBe(before[1])
    expect(after[2]).not.toBe(before[2])
    expect(await (await routes.request(before[2] ?? '')).text()).toBe('console.log(1)')
  })

  it('leaves a reference to a file the build lacks as it is, and versions a repeated one alike', async () => {
    writeFileSync(
      join(dir, 'taskpane.html'),
      '<html><head><script src="taskpane.js"></script><script src="taskpane.js"></script>' +
        '<link href="missing.css" rel="stylesheet" /></head></html>'
    )

    const html = await (await addinRoutes({ dir, token }).request('/taskpane.html')).text()

    const [first, second] = [...html.matchAll(/src="([^"]+)"/g)].map((match) => match[1])
    expect(first).toMatch(/^taskpane\.js\?v=\w+$/)
    expect(second).toBe(first)
    expect(html).toContain('href="missing.css"')
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

  it('serves a module mounted under its own path alike, its relative assets resolving under it', async () => {
    writeFileSync(
      join(dir, 'taskpane.html'),
      '<html><head><script defer src="taskpane.js"></script></head></html>'
    )
    const mount = '/m/stylistic-addon'
    const app = new Hono().route(mount, addinRoutes({ dir, token, mount }))

    const page = await app.request(`${mount}/taskpane.html`)
    const html = await page.text()
    const script = html.match(/src="([^"]+)"/)?.[1] ?? ''
    const asset = await app.request(new URL(script, `https://localhost:3000${mount}/taskpane.html`).href)
    const icon = await app.request(`${mount}/assets/icon-32.png`)

    expect(page.headers.get('cache-control')).toBe('no-store')
    expect(html).toContain(`<meta name="stylistic-hub-token" content="${token}"></head>`)
    expect(script).toMatch(/^taskpane\.js\?v=\w+$/)
    expect(await asset.text()).toBe('console.log(1)')
    expect(asset.headers.get('cache-control')).toBe('no-cache')
    expect(icon.headers.get('content-type')).toBe('image/png')
    expect((await app.request(`${mount}/../hub-addin-secret.txt`)).status).toBe(404)
    expect((await app.request(`${mount}/%2e%2e/hub-addin-secret.txt`)).status).toBe(404)
  })
})

/** What the guard does in a task pane opened at `url`, once its wait is over. */
function runGuard({ url, bridged, reloads }: { url: string; bridged: boolean; reloads?: string }) {
  const storage = new Map<string, string>(
    reloads === undefined ? [] : [['stylistic.hostBridgeReloads', reloads]]
  )
  const waits: (() => void)[] = []
  let reloaded = 0
  runInNewContext(HOST_BRIDGE_GUARD, {
    window: { external: bridged ? { GetContext: () => ({}) } : {} },
    location: { search: new URL(url).search, reload: () => reloaded++ },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key)
    },
    setTimeout: (run: () => void) => waits.push(run)
  })
  for (const run of waits) run()
  return { reloaded, stored: storage.get('stylistic.hostBridgeReloads') }
}

describe('HOST_BRIDGE_GUARD', () => {
  const inWord =
    'https://localhost:3000/m/stylistic-word-addin/taskpane.html?_host_Info=Word$Win32$16.01$en-US$$$$0'

  it('reloads the task pane once when Word opened it without its host bridge', () => {
    expect(runGuard({ url: inWord, bridged: false })).toEqual({ reloaded: 1, stored: '1' })
  })

  it('leaves a task pane Word opened with its bridge alone, and forgets earlier reloads', () => {
    expect(runGuard({ url: inWord, bridged: true, reloads: '1' })).toEqual({ reloaded: 0, stored: undefined })
  })

  it('stops after two reloads, so a Word that never bridges the pane does not reload it forever', () => {
    expect(runGuard({ url: inWord, bridged: false, reloads: '2' })).toEqual({ reloaded: 0, stored: '2' })
  })

  it('never reloads the page outside Word', () => {
    expect(runGuard({ url: 'https://localhost:3000/taskpane.html', bridged: false })).toEqual({
      reloaded: 0,
      stored: undefined
    })
  })
})
