import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channelControls, inRollout, offered } from './channels'
import { createUpdateEngine } from './engine'
import { HUB_ID, type CatalogEntry } from './install'
import { makeRelease, makeWorld, type Release, type World } from './test-fixtures'

/** The current test's world. */
let world: World

beforeEach(async () => {
  world = await makeWorld()
})

afterEach(async () => {
  await rm(join(world.root, '..'), { recursive: true, force: true })
})

/** The server release `version` on `channel`, with `schemaVersion` in its provides. */
function server(version: string, channel: 'stable' | 'beta' = 'stable', schemaVersion = 3): Promise<Release> {
  return makeRelease({ version, channel, provides: { api: ['v1'], schemaVersion } }, world.componentKey)
}

/** Publishes `releases` and runs a check; returns the installs. */
async function check(releases: Release[], serial: number) {
  world.publish({ releases, serial })
  return (await world.engine.runCheck()).installs
}

/** The server's state entry. */
async function serverState() {
  return (await world.engine.readState()).components['server']
}

describe('channel per component', () => {
  it('follows the stable channel when the state names none, as an M4 state file does', async () => {
    const stable = await server('1.0.0')
    const beta = await server('1.1.0-beta.1', 'beta')

    expect(await check([stable, beta], 100)).toEqual([
      { id: 'server', version: '1.0.0', outcome: { status: 'installed' } }
    ])
    expect(await serverState()).not.toHaveProperty('channel')
  })

  it('installs the latest beta on the beta channel and ignores the stable entry', async () => {
    const stable = await server('1.0.0')
    const beta = await server('1.1.0-beta.1', 'beta')
    await check([stable, beta], 100)

    await world.engine.setChannel('server', 'beta')

    expect(await check([stable, beta], 101)).toEqual([
      { id: 'server', version: '1.1.0-beta.1', outcome: { status: 'installed' } }
    ])
    expect(await serverState()).toMatchObject({ current: '1.1.0-beta.1', previous: '1.0.0', channel: 'beta' })
  })

  it('switching back to stable installs the older stable version', async () => {
    const stable = await server('1.0.0')
    const beta = await server('1.1.0-beta.1', 'beta')
    await world.engine.setChannel('server', 'beta')
    await check([stable, beta], 100)

    await world.engine.setChannel('server', 'stable')

    expect(await check([stable, beta], 101)).toEqual([
      { id: 'server', version: '1.0.0', outcome: { status: 'installed' } }
    ])
    expect(await serverState()).toMatchObject({
      current: '1.0.0',
      previous: '1.1.0-beta.1',
      channel: 'stable'
    })
  })

  it("keeps the hub's channel apart from the components'", async () => {
    await world.engine.setChannel(HUB_ID, 'beta')

    const state = await world.engine.readState()
    expect(state.hub).toEqual({ channel: 'beta' })
    expect(state.components).toEqual({})
  })
})

describe('switching back with a database a stable server cannot read', () => {
  /** A database whose `minReaderSchema` is `minReaderSchema`, in the world's temp folder. */
  function database(minReaderSchema: number): string {
    const file = join(world.root, '..', 'stylistic.db')
    const db = new DatabaseSync(file)
    db.exec(`CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, min_reader_schema INTEGER NOT NULL);
    INSERT INTO schema_meta VALUES (1, ${minReaderSchema}); PRAGMA user_version = ${minReaderSchema};`)
    db.close()
    return file
  }

  // L2's hypothesis: switching to stable after a beta contract migration never starts a server that refuses
  // the database. The stable 1.0.0 writes schema 3; the beta migrated the database to minReaderSchema 4.
  it('keeps the beta server, restores nothing, and records why', async () => {
    const engine = createUpdateEngine({ ...world.context, database: database(4) }, [world.rootKey.raw])
    const stable = await server('1.0.0')
    const beta = await server('1.1.0-beta.1', 'beta', 4)
    await engine.setChannel('server', 'beta')
    world.publish({ releases: [stable, beta], serial: 100 })
    await engine.runCheck()

    await engine.setChannel('server', 'stable')
    world.publish({ releases: [stable, beta], serial: 101 })
    const reason = 'stays on 1.1.0-beta.1 until stable reads this database'

    expect((await engine.runCheck()).installs).toEqual([
      { id: 'server', version: '1.0.0', outcome: { status: 'failed', reason } }
    ])
    const state = await engine.readState()
    expect(state.components['server']).toMatchObject({ current: '1.1.0-beta.1', previous: null })
    expect(state.history.at(-1)).toMatchObject({
      from: '1.1.0-beta.1',
      to: '1.0.0',
      outcome: 'failed',
      reason
    })
    expect(world.seen.some((request) => request.url === stable.entry.artifactUrl)).toBe(false)
  })

  it('installs the stable server when it reads the database', async () => {
    const engine = createUpdateEngine({ ...world.context, database: database(3) }, [world.rootKey.raw])
    const stable = await server('1.0.0')
    const beta = await server('1.1.0-beta.1', 'beta', 4)
    await engine.setChannel('server', 'beta')
    world.publish({ releases: [stable, beta], serial: 100 })
    await engine.runCheck()

    await engine.setChannel('server', 'stable')
    world.publish({ releases: [stable, beta], serial: 101 })

    expect((await engine.runCheck()).installs[0]?.outcome).toEqual({ status: 'installed' })
  })

  it('treats a server that declares no schema as one that cannot read the database', async () => {
    const engine = createUpdateEngine({ ...world.context, database: database(3) }, [world.rootKey.raw])
    const noSchema = await makeRelease({ version: '1.0.0', provides: { api: ['v1'] } }, world.componentKey)
    world.publish({ releases: [noSchema], serial: 100 })

    expect((await engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'stays on the built-in server until stable reads this database'
    })
  })

  it('holds the server, without aborting the check, when the database cannot be read', async () => {
    const corrupt = join(world.root, '..', 'corrupt.db')
    await writeFile(corrupt, 'not a database, just bytes that are long enough to be read as a header')
    const engine = createUpdateEngine({ ...world.context, database: corrupt }, [world.rootKey.raw])
    world.publish({ releases: [await server('1.0.0', 'stable', 3)], serial: 100 })

    const report = await engine.runCheck()

    expect(report.catalog).toBe('ok')
    expect(report.verified).toBeDefined()
    expect(report.installs[0]?.outcome).toMatchObject({ status: 'failed' })
    const outcome = report.installs[0]?.outcome as { reason: string }
    expect(outcome.reason).toMatch(
      /^stays on the built-in server until stable reads this database \(unreadable: .+\)$/
    )
  })

  it('applies no guard when the database does not exist yet', async () => {
    const missing = join(world.root, '..', 'none.db')
    const engine = createUpdateEngine({ ...world.context, database: missing }, [world.rootKey.raw])
    world.publish({ releases: [await server('1.0.0', 'stable', 1)], serial: 100 })

    expect((await engine.runCheck()).installs[0]?.outcome).toEqual({ status: 'installed' })
  })
})

describe('staged rollout', () => {
  /** A catalog entry of server `version` at `rolloutPercent`. */
  const entry = (rolloutPercent: number, version = '1.0.0') =>
    ({ id: 'server', version, channel: 'stable', rolloutPercent, blocked: [] }) as unknown as CatalogEntry

  it('offers an entry at 10% to about 10% of a population of install ids', () => {
    const ids = Array.from({ length: 10_000 }, () => randomUUID())
    const share = ids.filter((id) => inRollout(id, entry(10))).length / ids.length

    expect(share).toBeGreaterThanOrEqual(0.09)
    expect(share).toBeLessThanOrEqual(0.11)
  })

  it('gives the same id the same answer, and every id the update at 100% and none at 0%', () => {
    const ids = Array.from({ length: 200 }, () => randomUUID())

    expect(ids.map((id) => inRollout(id, entry(50)))).toEqual(ids.map((id) => inRollout(id, entry(50))))
    expect(ids.every((id) => inRollout(id, entry(100)))).toBe(true)
    expect(ids.some((id) => inRollout(id, entry(0)))).toBe(false)
  })

  it('reads the first 4 bytes of sha256(installId:id:version) modulo 100', () => {
    // sha256('a:server:1.0.0') starts with 0x6e98bc41 = 1 855 503 425, which is 25 modulo 100.
    expect(inRollout('a', entry(26))).toBe(true)
    expect(inRollout('a', entry(25))).toBe(false)
  })

  it('creates the install id once and skips an update outside the rollout', async () => {
    const outside = await server('1.0.0')
    outside.entry.rolloutPercent = 0
    expect(await check([outside], 100)).toEqual([])
    const { installId } = await world.engine.readState()

    const inside = await server('1.0.1')
    expect(await check([inside], 101)).toHaveLength(1)
    expect(installId).toMatch(/^[0-9a-f-]{36}$/)
    expect((await world.engine.readState()).installId).toBe(installId)
  })
})

describe('pulled versions', () => {
  it('never installs a version listed in its entry', async () => {
    const pulled = await server('1.0.0')
    pulled.entry.blocked = ['1.0.0']

    expect(await check([pulled], 100)).toEqual([])
    expect(offered(pulled.entry, 'stable', 'any')).toBe(false)
  })
})

describe('channel controls', () => {
  it('reads both channels, sets one, and then runs a catalog check', async () => {
    const check = vi.fn()
    const controls = channelControls(world.engine, check)
    expect(await controls.get()).toEqual({ server: 'stable', hub: 'stable' })

    await controls.set('hub', 'beta')
    await controls.set('server', 'beta')

    expect(await controls.get()).toEqual({ server: 'beta', hub: 'beta' })
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('refuses anything but a known target and channel, writing nothing', async () => {
    const check = vi.fn()
    const controls = channelControls(world.engine, check)

    await expect(controls.set('server', 'nightly')).rejects.toThrow()
    await expect(controls.set('modules', 'beta')).rejects.toThrow()

    expect(check).not.toHaveBeenCalled()
    expect(await world.engine.readState()).toEqual({ serial: 0, keysVersion: 0, components: {}, history: [] })
  })

  it('sets the channel of a module in the state (the Library screen), then runs a catalog check', async () => {
    const check = vi.fn()
    const controls = channelControls(world.engine, check)
    await world.engine.requestInstall('word-addin')

    await controls.set('word-addin', 'beta')

    expect((await world.engine.readState()).components['word-addin']?.channel).toBe('beta')
    expect(check).toHaveBeenCalledOnce()
  })

  it('refuses the channel of a module not in the state, which would request its install', async () => {
    const check = vi.fn()
    const controls = channelControls(world.engine, check)

    await expect(controls.set('word-addin', 'beta')).rejects.toThrow('word-addin is not installed')
    await expect(controls.set('../escape', 'beta')).rejects.toThrow()

    expect(check).not.toHaveBeenCalled()
    expect((await world.engine.readState()).components).toEqual({})
  })
})
