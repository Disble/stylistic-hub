import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServerStatus } from './server-status'
import { createServerSwitch, resolveServerTarget, serverDirFlag } from './server-switch'
import { makeRelease, makeWorld, type World } from './updates/test-fixtures'

/** The built-in backend the hub falls back to. */
const BUILT_IN = { entry: 'C:/hub/out/backend/entry.js', version: '0.0.1' }

/** The current test's world: server 1.0.0 then 1.1.0 installed, so 1.0.0 is the previous version. */
let world: World
/** `<userData>`, the components directory's parent. */
let userData: string
/** The hub database, beside the components directory as in `userData`. */
let database: string

beforeEach(async () => {
  world = await makeWorld()
  userData = join(world.root, '..')
  database = join(userData, 'stylistic.db')
  await install('1.0.0')
  await install('1.1.0')
})

afterEach(async () => {
  await rm(userData, { recursive: true, force: true })
})

/** Publishes server `version` (schema 3 unless said otherwise) and lets the engine install it. */
async function install(version: string, schemaVersion = 3) {
  const release = await makeRelease(
    { version, provides: { api: ['v1'], schemaVersion, minReaderSchema: schemaVersion } },
    world.componentKey
  )
  world.publish({ releases: [release], serial: 100 + Number(version.replaceAll('.', '')) })
  const report = await world.engine.runCheck()
  expect(report.installs).toEqual([{ id: 'server', version, outcome: { status: 'installed' } }])
}

/** A component version's entry file. */
function entryOf(version: string): string {
  return join(world.root, 'server', version, 'entry.js')
}

/** Writes a database at `userVersion` and `minReaderSchema` holding `rows` in table `t`. */
function writeDatabase(file: string, userVersion: number, minReaderSchema: number, rows: string[]) {
  const db = new DatabaseSync(file)
  db.exec(`PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS schema_meta (id INTEGER PRIMARY KEY, min_reader_schema INTEGER NOT NULL);
  INSERT OR REPLACE INTO schema_meta VALUES (1, ${minReaderSchema});
  CREATE TABLE IF NOT EXISTS t (v TEXT); DELETE FROM t;
  PRAGMA user_version = ${userVersion};`)
  for (const row of rows) db.prepare('INSERT INTO t VALUES (?)').run(row)
  db.close()
}

/** The rows of table `t`. */
function rowsOf(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true })
  const rows = (db.prepare('SELECT v FROM t').all() as { v: string }[]).map((row) => row.v)
  db.close()
  return rows
}

/** A switch over the world's engine, with a fake backend and a real status, and `healthy` as the health check. */
function makeSwitch(healthy: () => Promise<boolean>, devServerDir?: string) {
  const started: string[] = []
  const backend = {
    startFrom: vi.fn(async (entry: string) => void started.push(entry)),
    halt: vi.fn(async () => undefined)
  }
  const status = createServerStatus({ version: BUILT_IN.version, address: 'a', onChange: () => undefined })
  const serverSwitch = createServerSwitch({
    engine: world.engine,
    componentsRoot: world.root,
    database,
    builtIn: BUILT_IN,
    devServerDir,
    backend,
    healthy: vi.fn(healthy),
    status,
    log: () => undefined
  })
  return { serverSwitch, backend, started, status }
}

describe('serverDirFlag', () => {
  it('reads the directory after --server as an absolute path, and nothing without the flag', () => {
    expect(serverDirFlag(['electron', '.', '--server', 'out/server'], false)).toBe(resolve('out/server'))
    expect(serverDirFlag(['electron', '.', '--server'], false)).toBeUndefined()
    expect(serverDirFlag(['electron', '.'], false)).toBeUndefined()
  })

  it('ignores --server in a packaged hub', () => {
    expect(serverDirFlag(['stylistic-hub.exe', '--server', 'C:/dev/server'], true)).toBeUndefined()
  })
})

describe('resolveServerTarget', () => {
  it('prefers --server, then the current component, then the built-in backend', async () => {
    const server = (await world.engine.readState()).components['server']
    const options = { componentsRoot: world.root, builtIn: BUILT_IN, server }

    expect(resolveServerTarget({ ...options, devServerDir: 'C:/dev/server' })).toEqual({
      entry: join('C:/dev/server', 'entry.js'),
      component: null,
      version: 'development'
    })
    expect(resolveServerTarget(options)).toEqual({
      entry: entryOf('1.1.0'),
      component: '1.1.0',
      version: '1.1.0'
    })
    expect(resolveServerTarget({ ...options, server: undefined })).toEqual({ ...BUILT_IN, component: null })
  })

  it('falls back to the built-in backend when the current version is bad or has no entry file', async () => {
    const server = (await world.engine.readState()).components['server']
    const options = { componentsRoot: world.root, builtIn: BUILT_IN }

    expect(
      resolveServerTarget({ ...options, server: server && { ...server, bad: ['1.1.0'] } })
    ).toMatchObject({ entry: BUILT_IN.entry })
    rmSync(entryOf('1.1.0'))
    expect(resolveServerTarget({ ...options, server })).toMatchObject({ entry: BUILT_IN.entry })
  })
})

describe('createServerSwitch', () => {
  it('starts the current component and keeps it when it answers its health check', async () => {
    const { serverSwitch, started, status, backend } = makeSwitch(async () => true)

    await serverSwitch.start()

    expect(started).toEqual([entryOf('1.1.0')])
    expect(backend.halt).not.toHaveBeenCalled()
    expect(status.get()).toMatchObject({ version: '1.1.0', state: 'starting' })
    expect(status.get().reason).toBeUndefined()
    expect((await world.engine.readState()).components['server']).toMatchObject({ current: '1.1.0', bad: [] })
  })

  it('rolls back to the previous version after a failed health check and marks the failed one bad', async () => {
    const { serverSwitch, started, status, backend } = makeSwitch(
      vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    )

    await serverSwitch.start()

    expect(started).toEqual([entryOf('1.1.0'), entryOf('1.0.0')])
    expect(backend.halt).toHaveBeenCalledTimes(1)
    const state = await world.engine.readState()
    expect(state.components['server']).toMatchObject({ current: '1.0.0', bad: ['1.1.0'] })
    expect(state.history.slice(-2)).toMatchObject([
      { from: '1.1.0', outcome: 'marked_bad', reason: 'health_check_failed' },
      { from: '1.1.0', to: '1.0.0', outcome: 'switched', reason: null }
    ])
    expect(status.get()).toMatchObject({
      state: 'rolled-back',
      version: '1.0.0',
      reason: 'Server 1.1.0 failed its health check; the hub went back to 1.0.0.'
    })
  })

  it('rolls back on a crash loop, taking over from the supervisor', async () => {
    const { serverSwitch, started, status } = makeSwitch(() => new Promise(() => undefined))
    void serverSwitch.start()
    await vi.waitFor(() => expect(started).toHaveLength(1))

    expect(serverSwitch.restartAllowed()).toBe(true)
    expect(serverSwitch.crashLoop()).toBe(true)
    expect(serverSwitch.restartAllowed()).toBe(false)

    await vi.waitFor(() => expect(started).toEqual([entryOf('1.1.0'), entryOf('1.0.0')]))
    await vi.waitFor(() => expect(serverSwitch.restartAllowed()).toBe(true))
    const state = await world.engine.readState()
    expect(state.components['server']).toMatchObject({ current: '1.0.0', bad: ['1.1.0'] })
    expect(state.history.at(-2)).toMatchObject({ outcome: 'marked_bad', reason: 'crash_loop' })
    expect(status.get()).toMatchObject({
      state: 'rolled-back',
      reason: 'Server 1.1.0 kept crashing; the hub went back to 1.0.0.'
    })
  })

  it('ignores a late health result of a version a crash loop already rolled back', async () => {
    let answerFirst: (healthy: boolean) => void = () => undefined
    const healthy = vi
      .fn<() => Promise<boolean>>()
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValue(true)
    const { serverSwitch, started } = makeSwitch(healthy)
    const starting = serverSwitch.start()
    await vi.waitFor(() => expect(started).toHaveLength(1))
    serverSwitch.crashLoop()
    await vi.waitFor(() => expect(started).toHaveLength(2))

    answerFirst(false)
    await starting

    expect(started).toEqual([entryOf('1.1.0'), entryOf('1.0.0')])
    expect((await world.engine.readState()).components['server']).toMatchObject({
      current: '1.0.0',
      bad: ['1.1.0']
    })
  })

  it('restores nothing after an expand step and keeps the writes made since the upgrade', async () => {
    writeDatabase(database, 4, 3, ['before', 'after'])
    const { serverSwitch, started } = makeSwitch(
      vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    )

    await serverSwitch.start()

    expect(started.at(-1)).toBe(entryOf('1.0.0'))
    expect(rowsOf(database)).toEqual(['before', 'after'])
    expect((await world.engine.readState()).history.at(-1)).toMatchObject({
      outcome: 'switched',
      reason: null
    })
  })

  it('restores the backup from before the upgrade after a contract step and says the writes were lost', async () => {
    const backups = join(userData, 'backups')
    mkdirSync(backups)
    // A newer backup at an older schema (a restore of an older database) loses to the one at 1.0.0's schema.
    writeDatabase(join(backups, 'stylistic-schema2-20261012000000.db'), 2, 2, ['older'])
    writeDatabase(join(backups, 'stylistic-schema3-20261010000000.db'), 3, 3, ['before'])
    writeDatabase(join(backups, 'stylistic-schema4-20261015000000.db'), 4, 4, ['newer schema'])
    writeDatabase(database, 4, 4, ['before', 'after'])
    writeFileSync(`${database}-wal`, 'stale')
    writeFileSync(`${database}-shm`, 'stale')
    const { serverSwitch, started, status } = makeSwitch(
      vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    )

    await serverSwitch.start()

    expect(started.at(-1)).toBe(entryOf('1.0.0'))
    expect(existsSync(`${database}-wal`)).toBe(false)
    expect(existsSync(`${database}-shm`)).toBe(false)
    expect(rowsOf(database)).toEqual(['before'])
    expect((await world.engine.readState()).history.at(-1)).toMatchObject({
      outcome: 'switched',
      reason: 'writes_since_upgrade_lost: stylistic-schema3-20261010000000.db'
    })
    expect(status.get().reason).toBe(
      'Server 1.1.0 failed its health check; the hub went back to 1.0.0. The database was restored from ' +
        'its backup stylistic-schema3-20261010000000.db, so the changes made since then were lost.'
    )
  })

  it('falls back to an older readable backup when none was taken at the schema of the previous version', async () => {
    const backups = join(userData, 'backups')
    mkdirSync(backups)
    writeDatabase(join(backups, 'stylistic-schema1-20261012000000.db'), 1, 1, ['oldest'])
    writeDatabase(join(backups, 'stylistic-schema2-20261001000000.db'), 2, 2, ['older'])
    writeFileSync(join(backups, 'stylistic-schema3-20261010000000.db'), 'not a database')
    writeDatabase(database, 4, 4, ['before', 'after'])
    const { serverSwitch, status } = makeSwitch(
      vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true)
    )

    await serverSwitch.start()

    expect(rowsOf(database)).toEqual(['older'])
    expect(status.get().reason).toContain('stylistic-schema2-20261001000000.db')
  })

  it('refuses the downgrade and keeps the server stopped when no readable backup exists', async () => {
    const backups = join(userData, 'backups')
    mkdirSync(backups)
    writeFileSync(join(backups, 'stylistic-schema3-20261010000000.db'), 'not a database')
    writeDatabase(database, 4, 4, ['before', 'after'])
    const { serverSwitch, started, status, backend } = makeSwitch(async () => false)

    await serverSwitch.start()

    expect(started).toEqual([entryOf('1.1.0')])
    expect(backend.halt).toHaveBeenCalledTimes(1)
    expect(rowsOf(database)).toEqual(['before', 'after'])
    expect((await world.engine.readState()).components['server']).toMatchObject({
      current: '1.1.0',
      bad: ['1.1.0']
    })
    expect(status.get()).toMatchObject({
      state: 'rolled-back',
      reason:
        'Server 1.1.0 failed its health check; the hub cannot go back to 1.0.0 because no readable backup ' +
        'of the database from before the upgrade exists. The server is stopped.'
    })
    await serverSwitch.refresh()
    expect(started).toHaveLength(1)
  })

  it('runs the built-in backend, with the reason, when no previous version exists', async () => {
    await world.engine.markBad('server', '1.0.0', 'test')
    const { serverSwitch, started, status } = makeSwitch(async () => false)

    await serverSwitch.start()

    expect(started).toEqual([entryOf('1.1.0'), BUILT_IN.entry])
    expect((await world.engine.readState()).components['server']?.bad).toEqual(['1.0.0', '1.1.0'])
    expect(status.get()).toMatchObject({
      state: 'rolled-back',
      version: '0.0.1',
      reason:
        'Server 1.1.0 failed its health check; no earlier version is installed, so the built-in server runs.'
    })
  })

  it('lets the built-in backend keep restarting on a crash loop, with the reason', async () => {
    rmSync(join(world.root, 'server'), { recursive: true })
    const { serverSwitch, started, status } = makeSwitch(async () => true)
    await serverSwitch.start()

    expect(serverSwitch.crashLoop()).toBe(false)

    expect(started).toEqual([BUILT_IN.entry])
    expect(status.get().reason).toBe(
      'The server keeps crashing and there is no earlier version to go back to.'
    )
  })

  it('starts the built-in backend when state.json cannot be read', async () => {
    writeFileSync(join(world.root, 'state.json'), '{')
    const { serverSwitch, started } = makeSwitch(async () => true)

    await serverSwitch.start()

    expect(started).toEqual([BUILT_IN.entry])
  })

  it('starts --server without a health check', async () => {
    const { serverSwitch, started } = makeSwitch(async () => false, 'C:/dev/server')

    await serverSwitch.start()

    expect(started).toEqual([join('C:/dev/server', 'entry.js')])
  })

  it('leaves a check that finishes before the first start to that start', async () => {
    const { serverSwitch, started } = makeSwitch(async () => true)

    await serverSwitch.refresh()

    expect(started).toEqual([])
  })

  it('moves to a version installed by a catalog check, and stays when nothing changed', async () => {
    const { serverSwitch, started, status } = makeSwitch(async () => true)
    await serverSwitch.start()
    await serverSwitch.refresh()
    expect(started).toEqual([entryOf('1.1.0')])

    await install('1.2.0')
    await serverSwitch.refresh()

    expect(started).toEqual([entryOf('1.1.0'), entryOf('1.2.0')])
    expect(status.get().version).toBe('1.2.0')
  })

  it('shows why the server stays on its beta after a switch to stable, and only that reason', async () => {
    const { serverSwitch, started, status } = makeSwitch(async () => true)
    await serverSwitch.start()
    const failed = (reason: string) => ({
      id: 'server',
      version: '1.0.0',
      outcome: { status: 'failed' as const, reason }
    })

    await serverSwitch.refresh({ installs: [failed('network')] })
    expect(status.get().reason).toBeUndefined()

    await serverSwitch.refresh({ installs: [failed('stays on 1.1.0 until stable reads this database')] })

    expect(status.get().reason).toBe('The server stays on 1.1.0 until stable reads this database.')
    expect(started).toEqual([entryOf('1.1.0')])
  })
})
