import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CATALOG_URL } from './trust'
import { daysFromNow, makeRelease, makeWorld, type Release, type World } from './test-fixtures'

/** The current test's world. */
let world: World
/** Server 1.0.0, installed before each failure so the tests can see it stays. */
let installed: Release

beforeEach(async () => {
  world = await makeWorld()
  installed = await makeRelease({ version: '1.0.0' }, world.componentKey)
  world.publish({ releases: [installed], serial: 100 })
  await world.engine.runCheck()
})

afterEach(async () => {
  await rm(join(world.root, '..'), { recursive: true, force: true })
})

/** Asserts that server 1.0.0 is still installed and current, and the stored serial and version did not move. */
async function expectUntouched(serial = 100, keysVersion = 1): Promise<void> {
  const state = await world.engine.readState()
  expect(state.serial).toBe(serial)
  expect(state.keysVersion).toBe(keysVersion)
  expect(state.components['server']?.current).toBe('1.0.0')
  expect(await readFile(join(world.root, 'server', '1.0.0', 'entry.js'), 'utf8')).toBe(
    "console.log('server 1.0.0')"
  )
}

describe('catalog check', () => {
  it('stores the serial and the key list version of a verified catalog', async () => {
    const next = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [next], serial: 200, keys: world.keyList({ version: 3 }) })

    const check = await world.engine.checkCatalog()

    expect(check.status).toBe('ok')
    expect(await world.engine.readState()).toMatchObject({ serial: 200, keysVersion: 3 })
  })

  it('leaves installed components untouched when the catalog has expired', async () => {
    const next = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [next], serial: 200, expires: daysFromNow(-1) })

    expect(await world.engine.runCheck()).toEqual({ catalog: 'expired', installs: [] })
    await expectUntouched()
  })

  it('rejects an older catalog serial (rollback) and installs nothing', async () => {
    const next = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [next], serial: 99 })

    expect(await world.engine.runCheck()).toEqual({ catalog: 'rollback', installs: [] })
    await expectUntouched()
  })

  it('rejects an expired keys.json and keeps installed versions running', async () => {
    const next = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [next], serial: 200, keys: world.keyList({ expires: daysFromNow(-1) }) })

    expect(await world.engine.runCheck()).toEqual({ catalog: 'expired', installs: [] })
    await expectUntouched()
  })

  it('rejects a replayed keys.json older than the last one seen', async () => {
    world.publish({ releases: [installed], serial: 150, keys: world.keyList({ version: 2 }) })
    await world.engine.runCheck()
    const next = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [next], serial: 200, keys: world.keyList({ version: 1 }) })

    expect(await world.engine.runCheck()).toEqual({ catalog: 'replayed', installs: [] })
    await expectUntouched(150, 2)
  })

  it('rejects a catalog signed by a key the key list does not name', async () => {
    world.publish({ releases: [installed], serial: 200 })
    const stranger = await makeWorld()
    stranger.publish({ releases: [installed], serial: 200, keys: world.keyList() })
    world.routes.set(`${CATALOG_URL}catalog.json.sig`, stranger.routes.get(`${CATALOG_URL}catalog.json.sig`)!)

    expect(await world.engine.runCheck()).toEqual({ catalog: 'unknown_key', installs: [] })
    await expectUntouched()
    await rm(join(stranger.root, '..'), { recursive: true, force: true })
  })

  it('rejects a keys.json not signed by an embedded root key', async () => {
    const stranger = await makeWorld()
    stranger.publish({ releases: [installed], serial: 200, keys: world.keyList({ version: 2 }) })
    world.publish({ releases: [installed], serial: 200, keys: world.keyList({ version: 2 }) })
    world.routes.set(`${CATALOG_URL}keys.json.sig`, stranger.routes.get(`${CATALOG_URL}keys.json.sig`)!)

    expect(await world.engine.runCheck()).toEqual({ catalog: 'bad_signature', installs: [] })
    await expectUntouched()
    await rm(join(stranger.root, '..'), { recursive: true, force: true })
  })

  it('reports a network failure and leaves installed components untouched', async () => {
    world.routes.set(`${CATALOG_URL}catalog.json`, { error: true })

    expect(await world.engine.runCheck()).toEqual({ catalog: 'network', installs: [] })
    await expectUntouched()
  })

  it('reports a document that is not valid JSON or does not match its schema', async () => {
    world.routes.set(`${CATALOG_URL}keys.json`, 'not json')

    expect(await world.engine.runCheck()).toEqual({ catalog: 'invalid_document', installs: [] })
    await expectUntouched()
  })
})
