import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeRelease, makeWorld, newKey, type Release, type World } from './test-fixtures'

/** The current test's world. */
let world: World
/** Server 1.0.0, installed before each test. */
let first: Release

beforeEach(async () => {
  world = await makeWorld()
  first = await makeRelease({ version: '1.0.0' }, world.componentKey)
  world.publish({ releases: [first], serial: 100 })
  await world.engine.runCheck()
})

afterEach(async () => {
  await rm(join(world.root, '..'), { recursive: true, force: true })
})

/** The verified key list of the catalog currently published. */
async function verifiedKeys() {
  const check = await world.engine.checkCatalog()
  if (check.status !== 'ok') throw new Error(check.reason)
  return check.keys
}

describe('runCheck', () => {
  it('installs only the stable server and what is already installed, never the hub or another channel', async () => {
    const hub = await makeRelease({ id: 'hub', kind: 'hub', version: '1.0.1' }, world.componentKey)
    const addin = await makeRelease(
      { id: 'word-addin', kind: 'office-addin', version: '1.0.0' },
      world.componentKey
    )
    const beta = { ...first, entry: { ...first.entry, channel: 'beta' as const, version: '2.0.0-beta.1' } }
    world.publish({ releases: [first, hub, addin, beta], serial: 101 })

    expect(await world.engine.runCheck()).toMatchObject({ catalog: 'ok', installs: [] })
    expect(world.seen.filter((request) => !request.url.includes('/catalog/'))).toEqual([
      { url: first.entry.componentUrl, range: null },
      { url: `${first.entry.componentUrl}.sig`, range: null },
      { url: first.entry.artifactUrl, range: null }
    ])
    expect(Object.keys((await world.engine.readState()).components)).toEqual(['server'])
  })

  it('refuses a server that drops an API an installed module requires', async () => {
    const keys = await verifiedKeys()
    const addin = await makeRelease(
      { id: 'word-addin', kind: 'office-addin', version: '1.0.0', requires: { api: ['v1'] }, provides: {} },
      world.componentKey
    )
    const other = await makeRelease(
      { id: 'other-addin', kind: 'office-addin', version: '1.0.0', provides: {} },
      world.componentKey
    )
    world.publish({ releases: [first, addin, other], serial: 101 })
    expect(await world.engine.installComponent(addin.entry, keys)).toEqual({ status: 'installed' })
    expect(await world.engine.installComponent(other.entry, keys)).toEqual({ status: 'installed' })
    await world.engine.markBad('never-installed', '0.1.0', 'test')

    const v2Only = await makeRelease({ version: '2.0.0', provides: { api: ['v2'] } }, world.componentKey)
    world.publish({ releases: [v2Only, addin, other], serial: 102 })
    const refused = await world.engine.runCheck()

    expect(refused.installs).toEqual([
      {
        id: 'server',
        version: '2.0.0',
        outcome: { status: 'failed', reason: 'incompatible: word-addin requires api v1' }
      }
    ])
    expect((await world.engine.readState()).components['server']?.current).toBe('1.0.0')
    expect(existsSync(join(world.root, 'server', '2.0.0'))).toBe(false)

    const both = await makeRelease({ version: '2.1.0', provides: { api: ['v1', 'v2'] } }, world.componentKey)
    world.publish({ releases: [both, addin, other], serial: 103 })
    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({ status: 'installed' })
  })

  it('disables a version whose key was revoked and installs the catalog version signed by a listed key', async () => {
    const newComponentKey = newKey()
    const replacement = await makeRelease({ version: '1.1.0' }, newComponentKey)
    world.publish({
      releases: [replacement],
      serial: 101,
      keys: world.keyList({ version: 2, componentKeys: [newComponentKey] })
    })

    const report = await world.engine.runCheck()

    expect(report.installs).toEqual([{ id: 'server', version: '1.1.0', outcome: { status: 'installed' } }])
    const state = await world.engine.readState()
    expect(state.components['server']).toEqual({
      current: '1.1.0',
      previous: null,
      bad: [],
      keyId: newComponentKey.id
    })
    expect(state.history.slice(-2)).toEqual([
      {
        time: '2026-10-18T12:00:00.000Z',
        component: 'server',
        from: '1.0.0',
        to: null,
        outcome: 'disabled',
        reason: 'revoked_key'
      },
      {
        time: '2026-10-18T12:00:00.000Z',
        component: 'server',
        from: null,
        to: '1.1.0',
        outcome: 'installed',
        reason: null
      }
    ])
    expect((await readdir(join(world.root, 'server'))).sort()).toEqual(['1.1.0', '1.1.0.json'])
  })

  it('drops a previous version whose key was revoked as a rollback target', async () => {
    const newComponentKey = newKey()
    const second = await makeRelease({ version: '1.1.0' }, newComponentKey)
    const bothKeys = [world.componentKey, newComponentKey]
    world.publish({ releases: [second], serial: 101, keys: world.keyList({ componentKeys: bothKeys }) })
    await world.engine.runCheck()

    world.publish({
      releases: [second],
      serial: 102,
      keys: world.keyList({ version: 2, componentKeys: [newComponentKey] })
    })
    expect(await world.engine.runCheck()).toMatchObject({ catalog: 'ok', installs: [] })

    expect((await world.engine.readState()).components['server']).toMatchObject({
      current: '1.1.0',
      previous: null
    })
  })
})

describe('rollback primitives', () => {
  it('switches back to the previous version, marks the failed one bad and never retries it', async () => {
    const second = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [second], serial: 101 })
    await world.engine.runCheck()

    await world.engine.setCurrent('server', '1.0.0')
    await world.engine.markBad('server', '1.1.0', 'health check failed')
    await world.engine.markBad('server', '1.1.0', 'health check failed')

    const state = await world.engine.readState()
    expect(state.components['server']).toEqual({
      current: '1.0.0',
      previous: '1.1.0',
      bad: ['1.1.0'],
      keyId: world.componentKey.id
    })
    expect(state.history.slice(-3, -2)).toEqual([
      {
        time: '2026-10-18T12:00:00.000Z',
        component: 'server',
        from: '1.1.0',
        to: '1.0.0',
        outcome: 'switched',
        reason: null
      }
    ])
    expect(state.history.at(-1)).toEqual({
      time: '2026-10-18T12:00:00.000Z',
      component: 'server',
      from: '1.1.0',
      to: null,
      outcome: 'marked_bad',
      reason: 'health check failed'
    })

    world.publish({ releases: [second], serial: 102 })
    expect(await world.engine.runCheck()).toMatchObject({ catalog: 'ok', installs: [] })
  })
})
