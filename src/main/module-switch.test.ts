import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createModuleSwitch, MODULE_SCOPES, moduleDirFlags } from './module-switch'
import { ADDON_PUBLISHER, makeRelease, makeWorld, type World } from './updates/test-fixtures'

/** The module the tests install. */
const ID = 'word-addin'

/** The current test's world, with an empty components directory. */
let world: World

beforeEach(async () => {
  world = await makeWorld()
})

afterEach(async () => {
  await rm(join(world.root, '..'), { recursive: true, force: true })
})

/** The manifest of module version `version`. */
function manifestOf(version: string): string {
  return `<OfficeApp><Id>module-id</Id><Version>${version}.0</Version></OfficeApp>`
}

/** Publishes module `version` (with `requires`) and lets the engine install it. */
async function install(
  version: string,
  requires: Record<string, unknown> = { scopes: ['status', 'documents', 'no-such-scope', 7] }
) {
  const release = await makeRelease(
    {
      id: ID,
      kind: 'office-addin',
      publisher: ADDON_PUBLISHER,
      version,
      provides: {},
      requires,
      items: [
        { name: 'manifest.xml', data: manifestOf(version) },
        { name: 'taskpane.html', data: '<html><head></head></html>' }
      ]
    },
    world.addonKey
  )
  await world.engine.requestInstall(ID)
  world.publish({ releases: [release], serial: 100 + Number(version.replaceAll('.', '')) })
  const report = await world.engine.runCheck()
  expect(report.installs).toEqual([{ id: ID, version, outcome: { status: 'installed' } }])
}

/** A version's directory. */
function dirOf(version: string): string {
  return join(world.root, ID, version)
}

/** The stable manifest Word registers. */
function stableManifest(): string {
  return join(world.root, ID, 'manifest.xml')
}

/** A switch over the world's engine with a fake backend; `healthy` answers the module's health check. */
function makeSwitch({
  healthy = async () => true,
  serverHealthy = async () => true,
  servesModules = async () => true,
  devModules = {},
  restartAllowed = () => true
}: {
  healthy?: (id: string) => Promise<boolean>
  serverHealthy?: () => Promise<boolean>
  servesModules?: () => Promise<boolean>
  devModules?: Record<string, string>
  restartAllowed?: () => boolean
} = {}) {
  const backend = { setModules: vi.fn<(value: string | undefined) => void>(), restart: vi.fn() }
  const onChange = vi.fn()
  const report = vi.fn<(message: string) => void>()
  const healthCheck = vi.fn(healthy)
  const log = vi.fn<(message: string) => void>()
  const moduleSwitch = createModuleSwitch({
    engine: world.engine,
    componentsRoot: world.root,
    devModules,
    backend,
    restartAllowed,
    healthy: healthCheck,
    serverHealthy,
    servesModules,
    onChange,
    report,
    log
  })
  /** The modules the backend was last given, parsed. */
  const served = () => {
    const value = backend.setModules.mock.calls.at(-1)?.[0]
    return value === undefined ? undefined : (JSON.parse(value) as Record<string, unknown>)
  }
  return { moduleSwitch, backend, onChange, report, healthCheck, served, log }
}

describe('moduleDirFlags', () => {
  it('reads every --module <id>=<dir> as an absolute directory', () => {
    expect(
      moduleDirFlags(['electron', '.', '--module', `${ID}=out/addin`, '--module', 'other-module=C:/m'], false)
    ).toEqual({ [ID]: resolve('out/addin'), 'other-module': resolve('C:/m') })
    expect(moduleDirFlags(['electron', '.'], false)).toEqual({})
  })

  it('ignores a value that is not <id>=<dir> or names an invalid id', () => {
    expect(
      moduleDirFlags(['electron', '--module', 'no-dir', '--module', 'Bad_Id=x', '--module', `${ID}=`], false)
    ).toEqual({})
    expect(moduleDirFlags(['electron', '--module'], false)).toEqual({})
  })

  it('ignores --module in a packaged hub', () => {
    expect(moduleDirFlags(['stylistic-hub.exe', '--module', `${ID}=C:/dev/addin`], true)).toEqual({})
  })
})

describe('MODULE_SCOPES', () => {
  it('lists the scopes the backend accepts in STYLISTIC_MODULES', () => {
    // The shell may not import the backend, so the list is compared with the backend's source.
    const source = readFileSync(
      join(import.meta.dirname, '../backend/adapters/http/module-tokens.ts'),
      'utf8'
    )
    const listed = /API_SCOPES = \[([^\]]+)\]/.exec(source)?.[1]

    expect(listed?.split(',').map((scope) => scope.trim().replaceAll("'", ''))).toEqual([...MODULE_SCOPES])
  })
})

describe('createModuleSwitch', () => {
  it('gives the backend no modules when none is installed, without a restart', async () => {
    const { moduleSwitch, backend } = makeSwitch()

    await moduleSwitch.start()

    expect(backend.setModules).toHaveBeenCalledWith(undefined)
    expect(backend.restart).not.toHaveBeenCalled()
    expect(moduleSwitch.manifests()).toEqual([])
  })

  it('serves the current version of each installed module with the known scopes it declared', async () => {
    await install('1.0.0')
    const { moduleSwitch, backend, served, healthCheck, onChange } = makeSwitch()

    await moduleSwitch.start()

    expect(served()).toEqual({ [ID]: { dir: dirOf('1.0.0'), scopes: ['status', 'documents'] } })
    expect(backend.restart).not.toHaveBeenCalled()
    expect(readFileSync(stableManifest(), 'utf8')).toBe(manifestOf('1.0.0'))
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(healthCheck).toHaveBeenCalledWith(ID)
    expect(moduleSwitch.manifests()).toEqual([stableManifest()])
  })

  it('serves a module with no scopes when its component.json declares none', async () => {
    await install('1.0.0', {})
    const { moduleSwitch, served } = makeSwitch()

    await moduleSwitch.start()

    expect(served()).toEqual({ [ID]: { dir: dirOf('1.0.0'), scopes: [] } })
  })

  it('leaves out a module version whose manifest names no version, so the backend still starts', async () => {
    await install('1.0.0')
    writeFileSync(join(dirOf('1.0.0'), 'manifest.xml'), '<OfficeApp></OfficeApp>')
    const { moduleSwitch, backend } = makeSwitch()

    await moduleSwitch.start()

    expect(backend.setModules).toHaveBeenCalledWith(undefined)
    expect(moduleSwitch.manifests()).toEqual([])
  })

  it('restarts the backend only when the set of served modules changes', async () => {
    await install('1.0.0')
    const { moduleSwitch, backend, served } = makeSwitch()
    await moduleSwitch.start()
    await moduleSwitch.refresh()
    expect(backend.restart).not.toHaveBeenCalled()

    await install('1.1.0')
    await moduleSwitch.refresh()

    expect(backend.restart).toHaveBeenCalledTimes(1)
    expect(served()).toEqual({ [ID]: { dir: dirOf('1.1.0'), scopes: ['status', 'documents'] } })
    expect(readFileSync(stableManifest(), 'utf8')).toBe(manifestOf('1.1.0'))
  })

  it('sets the modules but leaves the restart to a running server rollback', async () => {
    const { moduleSwitch, backend, served } = makeSwitch({ restartAllowed: () => false })
    await moduleSwitch.start()

    await install('1.0.0')
    await moduleSwitch.refresh()

    expect(served()).toMatchObject({ [ID]: { dir: dirOf('1.0.0') } })
    expect(backend.restart).not.toHaveBeenCalled()
  })

  it('stops serving an uninstalled module', async () => {
    await install('1.0.0')
    const { moduleSwitch, backend, onChange } = makeSwitch()
    await moduleSwitch.start()
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))

    await world.engine.uninstall(ID)
    await moduleSwitch.refresh()

    expect(backend.setModules).toHaveBeenLastCalledWith(undefined)
    expect(backend.restart).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(moduleSwitch.manifests()).toEqual([])
  })

  it('leaves a check that finishes before the first start to that start', async () => {
    await install('1.0.0')
    const { moduleSwitch, backend } = makeSwitch()

    await moduleSwitch.refresh()

    expect(backend.setModules).not.toHaveBeenCalled()
  })

  it('goes back to the previous version after a failed health check and marks the failed one bad', async () => {
    await install('1.0.0')
    await install('1.1.0')
    const healthy = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const { moduleSwitch, backend, served, report, onChange } = makeSwitch({ healthy })

    await moduleSwitch.start()

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    const state = await world.engine.readState()
    expect(state.components[ID]).toMatchObject({ current: '1.0.0', bad: ['1.1.0'] })
    expect(state.history.slice(-2)).toMatchObject([
      { component: ID, from: '1.1.0', outcome: 'marked_bad', reason: 'health_check_failed' },
      { component: ID, from: '1.1.0', to: '1.0.0', outcome: 'switched', reason: null }
    ])
    expect(served()).toEqual({ [ID]: { dir: dirOf('1.0.0'), scopes: ['status', 'documents'] } })
    expect(backend.restart).toHaveBeenCalledTimes(1)
    expect(readFileSync(stableManifest(), 'utf8')).toBe(manifestOf('1.0.0'))
    expect(report).toHaveBeenCalledWith(
      `Module ${ID} 1.1.0 failed its health check; the hub went back to 1.0.0.`
    )
  })

  it('stops serving a module that fails its health check with no earlier version', async () => {
    await install('1.0.0')
    const { moduleSwitch, backend, report, onChange } = makeSwitch({ healthy: async () => false })

    await moduleSwitch.start()

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(backend.setModules).toHaveBeenLastCalledWith(undefined)
    expect(backend.restart).toHaveBeenCalledTimes(1)
    expect((await world.engine.readState()).components[ID]).toMatchObject({
      current: '1.0.0',
      bad: ['1.0.0']
    })
    expect(moduleSwitch.manifests()).toEqual([])
    expect(report).toHaveBeenCalledWith(
      `Module ${ID} 1.0.0 failed its health check; no earlier version is installed, so it is not served.`
    )
  })

  it('ignores a late health result of a version a newer switch replaced', async () => {
    await install('1.0.0')
    let answerFirst: (healthy: boolean) => void = () => undefined
    const healthy = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValue(true)
    const { moduleSwitch, onChange } = makeSwitch({ healthy })
    await moduleSwitch.start()
    await vi.waitFor(() => expect(healthy).toHaveBeenCalledTimes(1))
    await install('1.1.0')
    await moduleSwitch.refresh()
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))

    answerFirst(false)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect((await world.engine.readState()).components[ID]).toMatchObject({ current: '1.1.0', bad: [] })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('drops the pending health check of a module uninstalled meanwhile, so it is not installed again', async () => {
    await install('1.0.0')
    let answer: (healthy: boolean) => void = () => undefined
    const healthy = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const { moduleSwitch, report } = makeSwitch({ healthy })
    await moduleSwitch.start()
    await vi.waitFor(() => expect(healthy).toHaveBeenCalledTimes(1))
    await world.engine.uninstall(ID)
    await moduleSwitch.refresh()

    answer(false)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect((await world.engine.readState()).components[ID]).toBeUndefined()
    expect(report).not.toHaveBeenCalled()
    expect((await world.engine.runCheck()).installs).toEqual([])
  })

  it('gives no verdict on a version that is no longer current when its health check fails', async () => {
    await install('1.0.0')
    let answer: (healthy: boolean) => void = () => undefined
    const healthy = vi
      .fn<(id: string) => Promise<boolean>>()
      .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    const { moduleSwitch, report } = makeSwitch({ healthy })
    await moduleSwitch.start()
    await vi.waitFor(() => expect(healthy).toHaveBeenCalledTimes(1))
    await install('1.1.0')

    answer(false)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect((await world.engine.readState()).components[ID]).toMatchObject({ current: '1.1.0', bad: [] })
    expect(report).not.toHaveBeenCalled()
  })

  it('gives no verdict on a module while the server itself is not healthy', async () => {
    await install('1.0.0')
    const { moduleSwitch, healthCheck, onChange } = makeSwitch({ serverHealthy: async () => false })

    await moduleSwitch.start()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(healthCheck).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect((await world.engine.readState()).components[ID]?.bad).toEqual([])
  })

  it('gives no verdict on a module while the running server serves no modules yet', async () => {
    await install('1.0.0')
    const { moduleSwitch, healthCheck, onChange, report } = makeSwitch({ servesModules: async () => false })

    await moduleSwitch.start()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(healthCheck).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect((await world.engine.readState()).components[ID]?.bad).toEqual([])
    expect(report).toHaveBeenCalledWith(
      `The running server does not serve modules yet, so ${ID} 1.0.0 waits for a server that does.`
    )
  })

  it('reports a rollback that fails instead of throwing', async () => {
    await install('1.0.0')
    await install('1.1.0')
    const { moduleSwitch, report } = makeSwitch({ healthy: async () => false })
    await rm(join(world.root, ID, '1.0.0.json'))

    await moduleSwitch.start()

    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith(
        expect.stringMatching(/^Module word-addin 1.1.0 failed .* rollback failed/)
      )
    )
  })

  it('serves --module with every scope in place of the installed version, without a health check', async () => {
    await install('1.0.0')
    const dev = join(world.root, '..', 'dev-addin')
    mkdirSync(dev)
    writeFileSync(join(dev, 'manifest.xml'), manifestOf('9.9.9'))
    const { moduleSwitch, served, healthCheck } = makeSwitch({ devModules: { [ID]: dev } })

    await moduleSwitch.start()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(served()).toEqual({ [ID]: { dir: dev, scopes: [...MODULE_SCOPES] } })
    expect(healthCheck).not.toHaveBeenCalled()
    expect(moduleSwitch.manifests()).toEqual([])
    expect(existsSync(stableManifest())).toBe(false)
  })

  it('starts with no modules when state.json cannot be read', async () => {
    mkdirSync(world.root, { recursive: true })
    writeFileSync(join(world.root, 'state.json'), '{')
    const { moduleSwitch, backend } = makeSwitch()

    await moduleSwitch.start()

    expect(backend.setModules).toHaveBeenCalledWith(undefined)
  })

  it('logs a health check that throws and gives no verdict', async () => {
    await install('1.0.0')
    const { moduleSwitch, log, onChange } = makeSwitch({ healthy: () => Promise.reject(new Error('boom')) })

    await moduleSwitch.start()

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('module word-addin 1.0.0: Error: boom'))
    expect(onChange).not.toHaveBeenCalled()
    expect((await world.engine.readState()).components[ID]?.bad).toEqual([])
  })

  it('still checks a module whose stable manifest cannot be written, and says why', async () => {
    await install('1.0.0')
    mkdirSync(stableManifest())
    const { moduleSwitch, log, onChange } = makeSwitch()

    await moduleSwitch.start()

    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^module word-addin 1.0.0: cannot write its stable manifest/)
    )
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
  })

  it('does not serve a --module directory without a manifest version, and says why', async () => {
    const dev = join(world.root, '..', 'dev-addin')
    const { moduleSwitch, backend, log } = makeSwitch({ devModules: { [ID]: dev } })

    await moduleSwitch.start()

    expect(backend.setModules).toHaveBeenCalledWith(undefined)
    expect(log).toHaveBeenCalledWith(
      `--module ${ID}: ${dev} has no manifest.xml with a <Version>, so it is not served`
    )
  })
})
