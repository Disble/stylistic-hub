// Startup ordering between module resolution and Word cleanup (odd/tasks/catalog-only-word.md B3): the hub
// must resolve the served modules before tidying Word's registration, or it deletes the legacy entry of an
// upgrade before knowing the module that replaces it. Uses the real module switch and Word integration over
// isolated fakes: a stateful fake registry, never the real one, and fixture-built modules, never Word.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModuleSwitch } from './module-switch'
import { ADDON_PUBLISHER, makeRelease, makeWorld, type World } from './updates/test-fixtures'
import { createWordIntegration, type RunCommand } from './word-integration'

/** The production add-in id the staged installer and the signed module releases share. */
const PRODUCTION_ID = '5d0c6b1e-7f2a-4c3e-9b8d-1a2f3e4c5d6e'

/** The Word module id the signed catalog actually offers: installs here use the real id. */
function catalogWordId(): string {
  const source = JSON.parse(readFileSync('catalog/catalog.source.json', 'utf8')) as {
    components: { id: string; kind: string }[]
  }
  const id = source.components.find((component) => component.kind === 'office-addin')?.id
  if (!id) throw new Error('The catalog offers no office-addin module')
  return id
}

/** The real catalog id under test. */
const MODULE_ID = catalogWordId()

/** The unrelated Office registration that must survive every test. */
const SOMEONE_ELSE = 'D:\\other\\manifest.xml'

/** Every scratch directory a test made, removed once the test is done. */
const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A Windows registry that only records what the integration asked for. */
function fakeRegistry(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  const query = (args: string[]) => {
    if (args[1] === '/v') {
      const path = values.get(args[3] ?? '')
      return path === undefined
        ? { code: 1, stdout: '' }
        : { code: 0, stdout: `    ${args[3]}    REG_SZ    ${path}\r\n` }
    }
    const lines = [...values].map(([name, path]) => `    ${name}    REG_SZ    ${path}`)
    return { code: 0, stdout: ['', ...lines, ''].join('\r\n') }
  }
  const run = vi.fn<RunCommand>(async (command, args) => {
    if (command === 'certutil') return { code: 0, stdout: '' }
    if (command !== 'reg') return { code: 1, stdout: '' }
    switch (args[0]) {
      case 'query':
        return query(args)
      case 'add':
        values.set(args[3] ?? '', args[7] ?? '')
        return { code: 0, stdout: '' }
      case 'delete':
        values.delete(args[3] ?? '')
        return { code: 0, stdout: '' }
      default:
        return { code: 1, stdout: '' }
    }
  })
  return { values, run }
}

/** Installs the real Word module id with a manifest carrying the production id. */
async function installWordModule(world: World): Promise<void> {
  const release = await makeRelease(
    {
      id: MODULE_ID,
      kind: 'office-addin',
      publisher: ADDON_PUBLISHER,
      version: '1.0.0',
      provides: {},
      requires: { scopes: ['status', 'documents'] },
      items: [
        {
          name: 'manifest.xml',
          data: `<OfficeApp><Id>${PRODUCTION_ID}</Id><Version>1.0.0.0</Version></OfficeApp>`
        },
        { name: 'taskpane.html', data: '<html><head></head></html>' }
      ]
    },
    world.addonKey
  )
  await world.engine.requestInstall(MODULE_ID)
  world.publish({ releases: [release], serial: 200 })
  const report = await world.engine.runCheck()
  expect(report.installs).toEqual([{ id: MODULE_ID, version: '1.0.0', outcome: { status: 'installed' } }])
}

/** A module switch over the world's engine that serves into the world's components directory. */
function makeSwitch(world: World) {
  const backend = { setModules: vi.fn(), restart: vi.fn() }
  return createModuleSwitch({
    engine: world.engine,
    componentsRoot: world.root,
    devModules: {},
    backend,
    restartAllowed: () => true,
    healthy: async () => true,
    serverHealthy: async () => true,
    servesModules: async () => true,
    onChange: () => undefined,
    report: () => undefined,
    log: () => undefined
  })
}

/** The Word integration over the switch's stable manifests and the fake registry. */
function makeWord(
  moduleSwitch: ReturnType<typeof makeSwitch>,
  world: World,
  run: RunCommand,
  legacyManifest: string
) {
  const caFile = join(world.root, 'ca.pem')
  mkdirSync(world.root, { recursive: true })
  writeFileSync(caFile, 'ca')
  return createWordIntegration({
    run,
    caFile,
    manifestFile: legacyManifest,
    moduleManifests: () => moduleSwitch.manifests(),
    componentsRoot: world.root
  })
}

/** A missing legacy bundled manifest, as the catalog-only update leaves it. */
function legacyManifest(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hub-startup-'))
  scratches.push(dir)
  return join(dir, 'addin', 'manifest.xml')
}

describe('module readiness notifications', () => {
  it('notifies mounted screens after the module-change Word sync settles', () => {
    const source = readFileSync('src/main/app.ts', 'utf8')
    const callback = source.slice(
      source.indexOf('onChange: () =>'),
      source.indexOf('report: status.setReason')
    )
    // Electron lifecycle wiring cannot be imported without starting the desktop app. Pin the actual
    // callback, alongside the mounted renderer test with an early catalog event and late readiness.
    expect(callback).toMatch(/\.sync\(\)[\s\S]*\.catch\([\s\S]*\.then\(/)
    expect(callback).toContain("webContents.send('hub:library-checked')")
    expect(callback.indexOf("webContents.send('hub:library-checked')")).toBeGreaterThan(
      callback.indexOf('.sync()')
    )
  })
})

describe('startup ordering', () => {
  it('tidies Word only after the served modules resolved', () => {
    const source = readFileSync('src/main/app.ts', 'utf8')
    // The cleanup rides the resolution chain between module resolution and server start, so a failing
    // cleanup still starts the server. Plain markers: the chain is Electron wiring, untestable by import.
    const chain = source.slice(
      source.indexOf('Could not resolve the modules'),
      source.indexOf('serverSwitch.start()')
    )
    expect(chain).toContain('word.sync()')
    expect(chain).toContain('.catch(')
    expect(source).not.toMatch(/\n {4}void word\.sync\(\)/)
  })

  it('migrates a same-id legacy registration to the served module once modules resolved', async () => {
    const world = await makeWorld()
    scratches.push(join(world.root, '..'))
    await installWordModule(world)
    const moduleSwitch = makeSwitch(world)
    const legacy = legacyManifest()
    const { values, run } = fakeRegistry({ [PRODUCTION_ID]: legacy, 'someone-else': SOMEONE_ELSE })
    const word = makeWord(moduleSwitch, world, run, legacy)

    await moduleSwitch.start()
    await word.sync()

    const stable = join(world.root, MODULE_ID, 'manifest.xml')
    expect(values.get(PRODUCTION_ID)).toBe(stable)
    expect(values.get('someone-else')).toBe(SOMEONE_ELSE)
    expect(values.size).toBe(2)
  })

  it('drops a stale legacy registration when no module is served', async () => {
    const world = await makeWorld()
    scratches.push(join(world.root, '..'))
    const moduleSwitch = makeSwitch(world)
    const legacy = legacyManifest()
    const { values, run } = fakeRegistry({ [PRODUCTION_ID]: legacy, 'someone-else': SOMEONE_ELSE })
    const word = makeWord(moduleSwitch, world, run, legacy)

    await moduleSwitch.start()
    await word.sync()

    expect(values.has(PRODUCTION_ID)).toBe(false)
    expect(values.get('someone-else')).toBe(SOMEONE_ELSE)
  })

  it('does not resurrect a legacy entry purged before the modules resolved', async () => {
    const world = await makeWorld()
    scratches.push(join(world.root, '..'))
    await installWordModule(world)
    const moduleSwitch = makeSwitch(world)
    const legacy = legacyManifest()
    const { values, run } = fakeRegistry({ [PRODUCTION_ID]: legacy, 'someone-else': SOMEONE_ELSE })
    const word = makeWord(moduleSwitch, world, run, legacy)

    // The old startup race: cleanup runs while no manifest resolved yet.
    await word.sync()
    expect(values.has(PRODUCTION_ID)).toBe(false)
    await moduleSwitch.start()
    await word.sync()

    // Nothing owns a Word entry any more, so the later sync adds nothing: the upgrade intent is lost.
    expect(values.has(PRODUCTION_ID)).toBe(false)
    expect(values.size).toBe(1)
  })
})
