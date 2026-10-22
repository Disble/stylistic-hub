import { describe, expect, it, vi } from 'vitest'
import { buildLibrary, createLibrary, HISTORY_LINES } from './library'
import type { CheckReport, UpdateEngine } from './updates/engine'
import { HUB_ID, type CatalogEntry } from './updates/install'
import type { HistoryEntry, UpdateState } from './updates/state'

/** A catalog entry of `id` at `version`, fully rolled out on `channel` unless overridden. */
function entry(id: string, version: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    kind: id === 'server' ? 'server' : 'addin',
    channel: 'stable',
    version,
    rolloutPercent: 100,
    blocked: [],
    ...extra
  } as unknown as CatalogEntry
}

/** A state file with `components` and `history`. */
function state(
  components: UpdateState['components'] = {},
  history: HistoryEntry[] = [],
  hub?: UpdateState['hub']
): UpdateState {
  return { serial: 1, keysVersion: 1, components, history, installId: 'install-1', ...(hub && { hub }) }
}

/** An installed component entry. */
const installed = (current: string | null, channel?: 'stable' | 'beta') => ({
  current,
  previous: null,
  bad: [],
  keyId: current && 'k',
  ...(channel && { channel })
})

/** A history line of `component`. */
const line = (component: string, to: string, time = '2026-10-18T00:00:00.000Z'): HistoryEntry => ({
  time,
  component,
  from: null,
  to,
  outcome: 'installed',
  reason: null
})

/** The verified part of a successful check, over `components`. */
const verified = (components: CatalogEntry[]) => ({ catalog: { components }, installId: 'install-1' })

describe('buildLibrary', () => {
  it('shows the server, the hub and each module, installed or in the catalog', () => {
    const library = buildLibrary(
      state({ server: installed('1.0.0'), addin: installed('2.0.0') }),
      verified([entry('server', '1.1.0'), entry('addin', '2.0.0'), entry('glossary', '0.1.0')]),
      '0.9.0'
    )

    expect(library.firstRun).toBe(false)
    expect(library.catalog).toBe(true)
    expect(library.components).toEqual([
      {
        id: 'server',
        kind: 'server',
        installed: '1.0.0',
        requested: false,
        channel: 'stable',
        available: '1.1.0',
        history: []
      },
      {
        id: HUB_ID,
        kind: 'hub',
        installed: '0.9.0',
        requested: false,
        channel: 'stable',
        available: null,
        history: []
      },
      {
        id: 'addin',
        kind: 'module',
        installed: '2.0.0',
        requested: false,
        channel: 'stable',
        available: '2.0.0',
        history: []
      },
      {
        id: 'glossary',
        kind: 'module',
        installed: null,
        requested: false,
        channel: 'stable',
        available: '0.1.0',
        history: []
      }
    ])
  })

  it('offers the version of each component’s own channel', () => {
    const library = buildLibrary(
      state({ server: installed('1.0.0', 'beta') }, [], { channel: 'beta' }),
      verified([
        entry('server', '1.1.0'),
        entry('server', '1.2.0-beta.1', { channel: 'beta' }),
        entry(HUB_ID, '1.0.0'),
        entry(HUB_ID, '1.1.0-beta.2', { channel: 'beta' })
      ]),
      '1.0.0'
    )

    expect(library.components.slice(0, 2)).toMatchObject([
      { id: 'server', channel: 'beta', available: '1.2.0-beta.1' },
      { id: HUB_ID, channel: 'beta', available: '1.1.0-beta.2' }
    ])
  })

  it('offers a beta card the newest of its beta and stable versions, whatever the catalog order', () => {
    const library = buildLibrary(
      state({ server: installed('1.0.0', 'beta') }, [], { channel: 'beta' }),
      verified([
        entry('server', '1.2.0'),
        entry('server', '1.2.0-beta.1', { channel: 'beta' }),
        entry(HUB_ID, '1.0.0')
      ]),
      '1.0.0'
    )

    expect(library.components.slice(0, 2)).toMatchObject([
      { id: 'server', channel: 'beta', available: '1.2.0' },
      { id: HUB_ID, channel: 'beta', available: '1.0.0' }
    ])
  })

  it('marks on the hub card the downloaded update that installs when the hub restarts', () => {
    const library = buildLibrary(
      state({ server: installed('1.0.0') }),
      undefined,
      '1.1.1-beta.1',
      '1.2.0-beta.1'
    )

    expect(library.components.find((c) => c.kind === 'hub')?.ready).toBe('1.2.0-beta.1')
    expect(library.components.filter((c) => c.ready)).toHaveLength(1)
    expect(buildLibrary(state(), undefined, '1.0.0').components.some((c) => 'ready' in c)).toBe(false)
  })

  it('offers no pulled version and none outside this install’s rollout', () => {
    const library = buildLibrary(
      state({ server: installed('1.0.0') }),
      verified([
        entry('server', '1.1.0', { blocked: ['1.1.0'] }),
        entry('addin', '2.0.0', { rolloutPercent: 0 })
      ]),
      '1.0.0'
    )

    expect(library.components.find((c) => c.id === 'server')?.available).toBeNull()
    expect(library.components.find((c) => c.id === 'addin')?.available).toBeNull()
  })

  it('marks a module requested but not installed yet', () => {
    const library = buildLibrary(
      state({ server: installed('1.0.0'), addin: installed(null) }),
      undefined,
      '1.0.0'
    )

    expect(library.catalog).toBe(false)
    expect(library.components[2]).toMatchObject({
      id: 'addin',
      installed: null,
      requested: true,
      available: null
    })
  })

  it(`keeps the last ${HISTORY_LINES} history lines of each component, newest first`, () => {
    const history = [
      line('addin', '0.0.1'),
      ...Array.from({ length: HISTORY_LINES + 1 }, (_, n) => line('server', `1.0.${n}`)),
      line(HUB_ID, '0.9.0')
    ]

    const library = buildLibrary(
      state({ server: installed('1.0.6'), addin: installed('0.0.1') }, history),
      undefined,
      '0.9.0'
    )

    const server = library.components[0]?.history ?? []
    expect(server.map((h) => h.to)).toEqual(['1.0.5', '1.0.4', '1.0.3', '1.0.2', '1.0.1'])
    expect(server[0]).toEqual({
      time: '2026-10-18T00:00:00.000Z',
      from: null,
      to: '1.0.5',
      outcome: 'installed',
      reason: null
    })
    expect(library.components[1]?.history.map((h) => h.to)).toEqual(['0.9.0'])
    expect(library.components[2]?.history.map((h) => h.to)).toEqual(['0.0.1'])
  })

  it('is a first run while no server component is installed, listing the catalog’s modules', () => {
    const library = buildLibrary(
      state(),
      verified([entry('server', '1.0.0'), entry('addin', '2.0.0')]),
      '1.0.0'
    )

    expect(library.firstRun).toBe(true)
    expect(library.components.map((c) => [c.id, c.installed])).toEqual([
      ['server', null],
      [HUB_ID, '1.0.0'],
      ['addin', null]
    ])
  })
})

/** An engine double recording the calls the library makes. */
function fakeEngine(current: UpdateState) {
  return {
    readState: vi.fn(async () => current),
    requestInstall: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined)
  } satisfies Pick<UpdateEngine, 'readState' | 'requestInstall' | 'uninstall'>
}

describe('createLibrary', () => {
  it('lists from the state and the last verified catalog a check reported', async () => {
    const engine = fakeEngine(state({ server: installed('1.0.0') }))
    const library = createLibrary({ engine, check: vi.fn(), hubVersion: '1.0.0' })
    expect((await library.list()).catalog).toBe(false)

    library.observe({
      catalog: 'ok',
      installs: [],
      verified: verified([entry('addin', '2.0.0')])
    } as unknown as CheckReport)
    library.observe({ catalog: 'expired', installs: [] })

    const listed = await library.list()
    expect(listed.catalog).toBe(true)
    expect(listed.components.map((c) => c.id)).toEqual(['server', HUB_ID, 'addin'])
  })

  it('requests a module and then runs a catalog check, which installs it', async () => {
    const engine = fakeEngine(state())
    const check = vi.fn()
    const library = createLibrary({ engine, check, hubVersion: '1.0.0' })

    await library.install('addin')

    expect(engine.requestInstall).toHaveBeenCalledWith('addin')
    expect(check).toHaveBeenCalledOnce()
  })

  it('does not check when the engine refuses the request', async () => {
    const engine = fakeEngine(state())
    engine.requestInstall.mockRejectedValueOnce(new Error('server is not a module'))
    const check = vi.fn()
    const library = createLibrary({ engine, check, hubVersion: '1.0.0' })

    await expect(library.install('server')).rejects.toThrow('server is not a module')
    expect(check).not.toHaveBeenCalled()
  })

  it('uninstalls a module through the engine, then runs a check so it stops being served and registered', async () => {
    const engine = fakeEngine(state())
    const check = vi.fn()
    const library = createLibrary({ engine, check, hubVersion: '1.0.0' })

    await library.uninstall('addin')

    expect(engine.uninstall).toHaveBeenCalledWith('addin')
    expect(check).toHaveBeenCalledOnce()
  })

  it('shows the self-update’s ready version and restarts the hub into it on request', async () => {
    const restart = vi.fn()
    const library = createLibrary({
      engine: fakeEngine(state()),
      check: vi.fn(),
      hubVersion: '1.0.0',
      hubUpdate: { ready: () => '1.1.0', restart }
    })

    expect((await library.list()).components[1]).toMatchObject({ kind: 'hub', ready: '1.1.0' })
    await library.restart()
    expect(restart).toHaveBeenCalledOnce()
  })

  it('runs a catalog check on request', () => {
    const check = vi.fn()
    const library = createLibrary({ engine: fakeEngine(state()), check, hubVersion: '1.0.0' })

    library.check()

    expect(check).toHaveBeenCalledOnce()
  })
})
