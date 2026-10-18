import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HUB_ID } from './install'
import { ADDON_PUBLISHER, makeRelease, makeWorld, newKey, type Release, type World } from './test-fixtures'

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
  it('records why it switched back when a reason is given', async () => {
    const second = await makeRelease({ version: '1.1.0' }, world.componentKey)
    world.publish({ releases: [second], serial: 101 })
    await world.engine.runCheck()

    await world.engine.setCurrent('server', '1.0.0', 'writes_since_upgrade_lost')

    expect((await world.engine.readState()).history.at(-1)).toEqual({
      time: '2026-10-18T12:00:00.000Z',
      component: 'server',
      from: '1.1.0',
      to: '1.0.0',
      outcome: 'switched',
      reason: 'writes_since_upgrade_lost'
    })
  })
})

/** The `word-addin` module `version`, published by `stylistic-addon` and signed with its key unless `key` says otherwise. */
function addin(
  version: string,
  options: Partial<Parameters<typeof makeRelease>[0]> = {},
  key = world.addonKey
) {
  return makeRelease(
    { id: 'word-addin', kind: 'office-addin', publisher: ADDON_PUBLISHER, version, provides: {}, ...options },
    key
  )
}

/** Requests `word-addin`, publishes `releases` and runs a check; returns the installs. */
async function requestAndCheck(releases: Release[], serial = 101) {
  await world.engine.requestInstall('word-addin')
  world.publish({ releases, serial })
  return (await world.engine.runCheck()).installs
}

describe('modules on request', () => {
  it('installs an office-addin module from stylistic-addon the first time it is requested', async () => {
    const module = await addin('1.0.0', { requires: { api: ['v1'] } })

    expect(await requestAndCheck([first, module])).toEqual([
      { id: 'word-addin', version: '1.0.0', outcome: { status: 'installed' } }
    ])
    expect((await world.engine.readState()).components['word-addin']).toEqual({
      current: '1.0.0',
      previous: null,
      bad: [],
      keyId: world.addonKey.id
    })
    expect(existsSync(join(world.root, 'word-addin', '1.0.0', 'entry.js'))).toBe(true)
  })

  it('waits for the next check after a request and keeps an installed module as it is', async () => {
    await world.engine.requestInstall('word-addin')
    expect((await world.engine.readState()).components['word-addin']).toEqual({
      current: null,
      previous: null,
      bad: [],
      keyId: null
    })

    await requestAndCheck([first, await addin('1.0.0')])
    await world.engine.requestInstall('word-addin')
    expect((await world.engine.readState()).components['word-addin']?.current).toBe('1.0.0')
  })

  it('follows its channel, rollout and blocked rules', async () => {
    const beta = await addin('2.0.0-beta.1', { channel: 'beta' })
    const blocked = await addin('1.2.0')
    blocked.entry.blocked = ['1.2.0']
    const outOfRollout = await addin('1.1.0')
    outOfRollout.entry.rolloutPercent = 0
    expect(await requestAndCheck([first, beta, blocked, outOfRollout])).toEqual([])

    const stable = await addin('1.0.0')
    expect(await requestAndCheck([first, beta, blocked, outOfRollout, stable], 102)).toEqual([
      { id: 'word-addin', version: '1.0.0', outcome: { status: 'installed' } }
    ])
  })

  it('refuses a module whose publisher scope does not match its signing key', async () => {
    const module = await addin('1.0.0', {}, world.componentKey)

    expect(await requestAndCheck([first, module])).toEqual([
      { id: 'word-addin', version: '1.0.0', outcome: { status: 'failed', reason: 'wrong_scope' } }
    ])
  })

  it('refuses before the download a module that requires an API the current server lacks', async () => {
    const module = await addin('1.0.0', { requires: { api: ['v1', 'v2', 'v3'] } })

    expect(await requestAndCheck([first, module])).toEqual([
      { id: 'word-addin', version: '1.0.0', outcome: { status: 'failed', reason: 'requires api v2, v3' } }
    ])
    expect(world.seen.map((request) => request.url)).not.toContain(module.entry.artifactUrl)
    expect((await world.engine.readState()).components['word-addin']?.current).toBeNull()

    const v2 = await makeRelease(
      { version: '2.0.0', provides: { api: ['v1', 'v2', 'v3'] } },
      world.componentKey
    )
    world.publish({ releases: [v2], serial: 102 })
    await world.engine.runCheck()
    expect(await requestAndCheck([v2, module], 103)).toEqual([
      { id: 'word-addin', version: '1.0.0', outcome: { status: 'installed' } }
    ])
  })

  it('checks a module against the built-in backend, which provides v1, when no server is installed', async () => {
    await rm(join(world.root, '..'), { recursive: true, force: true })
    world = await makeWorld()
    const v1 = await addin('1.0.0', { requires: { api: 'v1' } })
    const v2 = await addin('1.1.0', { requires: { api: ['v2'] } })

    expect(await requestAndCheck([v2])).toEqual([
      { id: 'word-addin', version: '1.1.0', outcome: { status: 'failed', reason: 'requires api v2' } }
    ])
    expect(await requestAndCheck([v1], 102)).toEqual([
      { id: 'word-addin', version: '1.0.0', outcome: { status: 'installed' } }
    ])
  })

  it('uninstalls a module: its files, its state entry, and a history line', async () => {
    await requestAndCheck([first, await addin('1.0.0')])
    await requestAndCheck([first, await addin('1.1.0')], 102)

    await world.engine.uninstall('word-addin')

    expect(existsSync(join(world.root, 'word-addin'))).toBe(false)
    const state = await world.engine.readState()
    expect(state.components).not.toHaveProperty('word-addin')
    expect(state.history.at(-1)).toEqual({
      time: '2026-10-18T12:00:00.000Z',
      component: 'word-addin',
      from: '1.1.0',
      to: null,
      outcome: 'uninstalled',
      reason: null
    })
    world.publish({ releases: [first, await addin('1.1.0')], serial: 103 })
    expect((await world.engine.runCheck()).installs).toEqual([])
  })

  it('refuses to install or uninstall the server, the hub, an invalid id, or a module not installed', async () => {
    for (const id of ['server', HUB_ID, '..', 'A']) {
      await expect(world.engine.uninstall(id)).rejects.toThrow()
      await expect(world.engine.requestInstall(id)).rejects.toThrow()
    }
    await expect(world.engine.uninstall('word-addin')).rejects.toThrow('word-addin is not installed')
    expect(existsSync(join(world.root, 'server', '1.0.0'))).toBe(true)
    expect(Object.keys((await world.engine.readState()).components)).toEqual(['server'])
  })
})
