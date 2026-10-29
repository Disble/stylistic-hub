import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HubUpdateStatus } from '../../shared/bridge'
import type { CheckReport } from './engine'
import { createSelfUpdate, type SelfUpdate } from './self-update'
import { envelope, makeRelease, newKey, makeWorld, type Release, type World } from './test-fixtures'

/** The bytes of the hub installer 0.2.0. */
const INSTALLER = Buffer.from('MZ\u0090 Stylistic Hub 0.2.0 installer')

/** What the fake electron-updater saw when it was asked to check: the feed's latest.yml and installer. */
interface SeenCheck {
  url: string
  latest: { version: string; sha512: string; path: string }
  installer: Buffer
  allowDowngrade: boolean
}

/** The current test's world. */
let world: World
/** The hub 0.2.0 release. */
let hub: Release
/** Every check the fake updater was asked for. */
let checks: SeenCheck[]
/** The self-update under test, stopped after each test. */
let selfUpdate: SelfUpdate | undefined

beforeEach(async () => {
  world = await makeWorld()
  hub = await hubRelease('0.2.0')
  checks = []
})

afterEach(async () => {
  await selfUpdate?.stop()
  selfUpdate = undefined
  await rm(join(world.root, '..'), { recursive: true, force: true })
})

/** A signed hub release whose artifact is `INSTALLER`. */
function hubRelease(version: string, options: Parameters<typeof makeRelease>[0] = { version }) {
  return makeRelease(
    { id: 'stylistic-hub', kind: 'hub', zip: INSTALLER, maxUncompressedSize: INSTALLER.length, ...options },
    world.componentKey
  )
}

/** A fake electron-updater: reads the feed it is pointed at, as the generic provider would. */
const updater = {
  async check(url: string, { allowDowngrade }: { allowDowngrade: boolean }): Promise<void> {
    const latest = (await (await fetch(new URL('latest.yml', url))).json()) as SeenCheck['latest']
    const installer = Buffer.from(await (await fetch(new URL(latest.path, url))).arrayBuffer())
    checks.push({ url, latest, installer, allowDowngrade })
  }
}

/** How many times the served installer was withdrawn from install on quit. */
let cancels = 0
/** How many times electron-updater was asked to quit and install now. */
let installs = 0
/** Every status the self-update announced. */
let statuses: HubUpdateStatus[] = []

/** A self-update for a hub running `currentVersion`. */
function start(currentVersion = '0.1.0', check = updater.check): SelfUpdate {
  cancels = 0
  installs = 0
  statuses = []
  selfUpdate = createSelfUpdate({
    currentVersion,
    updater: { check, cancel: () => void cancels++, install: () => void installs++ },
    onStatus: (status) => void statuses.push(status)
  })
  return selfUpdate
}

/** Publishes `releases` and runs the engine's check; returns its report. */
async function runCheck(releases: Release[], serial = 100): Promise<CheckReport> {
  world.publish({ releases, serial })
  return world.engine.runCheck()
}

/** The hub's staging folder. */
const staging = () => join(world.root, 'stylistic-hub', '.staging')

/** Whether the installer was ever requested from the internet. */
const installerRequested = () => world.seen.some((request) => request.url === hub.entry.artifactUrl)

describe('createSelfUpdate', () => {
  it('serves the verified installer and its sha512, then asks electron-updater to check that feed', async () => {
    const report = await runCheck([hub])

    expect(await start().onReport(report, world.engine)).toEqual({ status: 'served', version: '0.2.0' })
    expect(checks).toHaveLength(1)
    expect(checks[0]?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(checks[0]?.latest).toMatchObject({
      version: '0.2.0',
      path: 'stylistic-hub-0.2.0.exe',
      sha512: createHash('sha512').update(INSTALLER).digest('base64')
    })
    expect(checks[0]?.installer).toEqual(INSTALLER)
    expect(checks[0]?.allowDowngrade).toBe(false)
    expect(await readdir(staging())).toContain('stylistic-hub-0.2.0.exe')
    // The engine itself never installs the hub as a component.
    expect((await world.engine.readState()).components['stylistic-hub']).toBeUndefined()
  })

  it('serves the same version once and stops the feed on stop()', async () => {
    const report = await runCheck([hub])
    const self = start()
    await self.onReport(report, world.engine)
    const downloads = world.seen.filter((request) => request.url === hub.entry.artifactUrl).length

    expect(await self.onReport(report, world.engine)).toEqual({ status: 'skipped', reason: 'already_served' })
    expect(world.seen.filter((request) => request.url === hub.entry.artifactUrl)).toHaveLength(downloads)
    expect(checks).toHaveLength(1)

    await self.stop()
    await expect(fetch(new URL('latest.yml', checks[0]?.url))).rejects.toThrow()
  })

  it('never serves a tampered installer: the sha256 differs, the download is deleted', async () => {
    world.publish({ releases: [hub], serial: 100 })
    const tampered = Buffer.from(INSTALLER)
    tampered.writeUInt8(tampered.readUInt8(0) ^ 1, 0)
    world.routes.set(hub.entry.artifactUrl, tampered)

    const outcome = await start().onReport(await world.engine.runCheck(), world.engine)

    expect(outcome).toEqual({ status: 'failed', reason: 'sha256_mismatch' })
    expect(checks).toEqual([])
    expect(existsSync(join(staging(), 'stylistic-hub-0.2.0.exe'))).toBe(false)
  })

  it('never serves an installer whose component.json signature is bad', async () => {
    world.publish({ releases: [hub], serial: 100 })
    const forged = { ...hub.component, releaseNotes: 'https://example.test/forged' }
    world.routes.set(`${hub.entry.componentUrl}.sig`, JSON.stringify(envelope(forged, world.componentKey)))

    const outcome = await start().onReport(await world.engine.runCheck(), world.engine)

    expect(outcome).toEqual({ status: 'failed', reason: 'bad_signature' })
    expect(checks).toEqual([])
    expect(installerRequested()).toBe(false)
  })

  it('verifies the hub against the stylistic-hub key scope, whatever publisher the catalog names', async () => {
    const addinKey = newKey()
    const signedByAddin = await makeRelease(
      {
        id: 'stylistic-hub',
        kind: 'hub',
        version: '0.2.0',
        zip: INSTALLER,
        maxUncompressedSize: INSTALLER.length
      },
      addinKey
    )
    const release = { ...signedByAddin, entry: { ...signedByAddin.entry, publisher: 'stylistic-addon' } }
    const keys = world.keyList()
    keys.keys.push({
      id: addinKey.id,
      role: 'component',
      scope: 'stylistic-addon',
      publicKey: addinKey.raw.toString('base64')
    })
    world.publish({ releases: [release], keys, serial: 100 })

    const outcome = await start().onReport(await world.engine.runCheck(), world.engine)

    expect(outcome).toEqual({ status: 'failed', reason: 'wrong_scope' })
    expect(checks).toEqual([])
  })

  it('never serves an installer whose component.json does not match the catalog entry', async () => {
    hub = await hubRelease('0.2.0', { version: '0.2.0', component: { version: '0.2.1' } })

    const outcome = await start().onReport(await runCheck([hub]), world.engine)

    expect(outcome).toEqual({ status: 'failed', reason: 'binding_mismatch' })
    expect(checks).toEqual([])
    expect(installerRequested()).toBe(false)
  })

  it.each([
    ['0.2.0', 'the same version'],
    ['0.3.0', 'a newer hub'],
    ['0.2.1-beta.1', 'a newer beta'],
    ['not a version', 'an unreadable version']
  ])('ignores the catalog hub when this hub runs %s (%s)', async (current) => {
    const outcome = await start(current).onReport(await runCheck([hub]), world.engine)

    expect(outcome).toEqual({ status: 'skipped', reason: 'not_newer' })
    expect(installerRequested()).toBe(false)
    expect(checks).toEqual([])
  })

  it.each(['0.1.9', '0.2.0-beta.3', '0.1.10'])('updates a hub running %s to 0.2.0', async (current) => {
    expect(await start(current).onReport(await runCheck([hub]), world.engine)).toEqual({
      status: 'served',
      version: '0.2.0'
    })
  })

  it('follows only the stable stylistic-hub entry of kind hub', async () => {
    const beta = { ...hub, entry: { ...hub.entry, channel: 'beta' as const } }
    const other = await makeRelease({ id: 'other-hub', kind: 'hub', version: '9.0.0' }, world.componentKey)
    const outcome = await start().onReport(await runCheck([beta, other]), world.engine)

    expect(outcome).toEqual({ status: 'skipped', reason: 'no_hub_entry' })
  })

  it('does nothing without a verified catalog', async () => {
    const report = await runCheck([hub])
    world.publish({ releases: [hub], serial: 99 })

    expect(await start().onReport(await world.engine.runCheck(), world.engine)).toEqual({
      status: 'skipped',
      reason: 'no_catalog'
    })
    expect(report.verified).toBeDefined()
    expect(installerRequested()).toBe(false)
  })

  it('reports why electron-updater failed, stops that feed, and tries again at the next report', async () => {
    const urls: string[] = []
    const self = start('0.1.0', (url) => {
      urls.push(url)
      return Promise.reject(new Error('offline'))
    })
    const report = await runCheck([hub])

    expect(await self.onReport(report, world.engine)).toEqual({
      status: 'failed',
      reason: 'updater: Error: offline'
    })
    await expect(fetch(new URL('latest.yml', urls[0]))).rejects.toThrow()
    expect(await self.onReport(report, world.engine)).toEqual({
      status: 'failed',
      reason: 'updater: Error: offline'
    })
    expect(urls).toHaveLength(2)
  })

  it('reports downloading, then ready once electron-updater has the installer, and restarts on request', async () => {
    const self = start()
    expect(self.status()).toBeUndefined()
    expect(() => self.restart()).toThrow('no_update_ready')
    expect(installs).toBe(0)

    await self.onReport(await runCheck([hub]), world.engine)

    expect(statuses).toEqual([
      { state: 'downloading', version: '0.2.0' },
      { state: 'ready', version: '0.2.0' }
    ])
    expect(self.status()).toEqual({ state: 'ready', version: '0.2.0' })
    await self.onReport(await runCheck([hub], 101), world.engine)
    expect(statuses).toHaveLength(2)
    self.restart()
    expect(installs).toBe(1)
  })

  it('reports why the update failed, and up to date when nothing newer is offered', async () => {
    world.publish({ releases: [hub], serial: 100 })
    world.routes.set(hub.entry.artifactUrl, Buffer.from('tampered'))
    const tampered = start()
    await tampered.onReport(await world.engine.runCheck(), world.engine)
    expect(tampered.status()).toMatchObject({ state: 'failed', version: '0.2.0' })
    await tampered.stop()

    const failing = start('0.1.0', () => Promise.reject(new Error('offline')))
    await failing.onReport(await runCheck([hub], 101), world.engine)
    expect(failing.status()).toEqual({ state: 'failed', version: '0.2.0', reason: 'updater: Error: offline' })
    expect(() => failing.restart()).toThrow('no_update_ready')
    await failing.stop()

    const current = start('0.2.0')
    await current.onReport(await runCheck([hub], 102), world.engine)
    expect(current.status()).toEqual({ state: 'up-to-date' })
    expect(statuses).toEqual([{ state: 'up-to-date' }])
  })

  it('is up to date again, not ready, after the channel withdrew the downloaded version', async () => {
    const beta = await hubRelease('0.3.0-beta.1', { version: '0.3.0-beta.1', channel: 'beta' })
    await world.engine.setChannel('stylistic-hub', 'beta')
    const self = start('0.2.0')
    await self.onReport(await runCheck([hub, beta], 101), world.engine)
    expect(self.status()).toEqual({ state: 'ready', version: '0.3.0-beta.1' })

    await world.engine.setChannel('stylistic-hub', 'stable')
    await self.onReport(await runCheck([hub, beta], 102), world.engine)

    expect(self.status()).toEqual({ state: 'up-to-date' })
    expect(() => self.restart()).toThrow('no_update_ready')
    expect(installs).toBe(0)
  })

  it('keeps its status when the catalog check failed', async () => {
    const self = start()
    await self.onReport(await runCheck([hub]), world.engine)

    await self.onReport({ catalog: 'expired', installs: [] }, world.engine)

    expect(self.status()).toEqual({ state: 'ready', version: '0.2.0' })
  })

  it('follows the beta channel to a published hub prerelease', async () => {
    const beta = await hubRelease('0.3.0-beta.1', { version: '0.3.0-beta.1', channel: 'beta' })
    await world.engine.setChannel('stylistic-hub', 'beta')

    expect(await start('0.2.0').onReport(await runCheck([hub, beta]), world.engine)).toEqual({
      status: 'served',
      version: '0.3.0-beta.1'
    })
    expect(checks[0]?.allowDowngrade).toBe(false)
  })

  it('goes back to the older stable hub after a switch from beta, allowing that downgrade only', async () => {
    const beta = await hubRelease('0.3.0-beta.1', { version: '0.3.0-beta.1', channel: 'beta' })
    await world.engine.setChannel('stylistic-hub', 'stable')

    expect(await start('0.3.0-beta.1').onReport(await runCheck([hub, beta]), world.engine)).toEqual({
      status: 'served',
      version: '0.2.0'
    })
    expect(checks[0]?.allowDowngrade).toBe(true)
  })

  it('withdraws a served beta from install on quit when the user switches back before restarting', async () => {
    const beta = await hubRelease('0.3.0-beta.1', { version: '0.3.0-beta.1', channel: 'beta' })
    await world.engine.setChannel('stylistic-hub', 'beta')
    const self = start('0.2.0')
    expect((await self.onReport(await runCheck([hub, beta]), world.engine)).status).toBe('served')

    await world.engine.setChannel('stylistic-hub', 'stable')

    expect(await self.onReport(await runCheck([hub, beta], 101), world.engine)).toEqual({
      status: 'skipped',
      reason: 'not_newer'
    })
    expect(cancels).toBe(1)
    expect(await self.onReport(await runCheck([hub, beta], 102), world.engine)).toMatchObject({
      status: 'skipped'
    })
    expect(cancels).toBe(1)
  })

  it('never downgrades on a switch to beta: a running stable newer than every beta stays', async () => {
    await world.engine.setChannel('stylistic-hub', 'beta')
    const beta = await hubRelease('0.2.0-beta.3', { version: '0.2.0-beta.3', channel: 'beta' })

    expect(await start('0.2.0').onReport(await runCheck([hub, beta]), world.engine)).toEqual({
      status: 'skipped',
      reason: 'not_newer'
    })
    expect(checks).toEqual([])
  })

  it('follows the beta channel to a stable hub when the catalog lists no newer beta', async () => {
    await world.engine.setChannel('stylistic-hub', 'beta')

    expect(await start('0.1.0').onReport(await runCheck([hub]), world.engine)).toEqual({
      status: 'served',
      version: '0.2.0'
    })
    expect(checks[0]?.allowDowngrade).toBe(false)
  })

  it('serves the newest offered hub, whatever the catalog order', async () => {
    await world.engine.setChannel('stylistic-hub', 'beta')
    const first = await hubRelease('0.3.0-beta.1', { version: '0.3.0-beta.1', channel: 'beta' })
    const second = await hubRelease('0.3.0-beta.2', { version: '0.3.0-beta.2', channel: 'beta' })

    expect(await start('0.2.0').onReport(await runCheck([first, second, hub]), world.engine)).toEqual({
      status: 'served',
      version: '0.3.0-beta.2'
    })
  })

  it('allows no downgrade within a channel', async () => {
    await world.engine.setChannel('stylistic-hub', 'beta')
    const beta = await hubRelease('0.3.0-beta.1', { version: '0.3.0-beta.1', channel: 'beta' })

    expect(await start('0.3.0-beta.2').onReport(await runCheck([beta]), world.engine)).toEqual({
      status: 'skipped',
      reason: 'not_newer'
    })
  })

  it('never offers a pulled hub version or one outside its rollout', async () => {
    const pulled = { ...hub, entry: { ...hub.entry, blocked: ['0.2.0'] } }
    expect(await start().onReport(await runCheck([pulled]), world.engine)).toEqual({
      status: 'skipped',
      reason: 'no_hub_entry'
    })

    const later = { ...hub, entry: { ...hub.entry, rolloutPercent: 0 } }
    expect(await start().onReport(await runCheck([later], 101), world.engine)).toEqual({
      status: 'skipped',
      reason: 'no_hub_entry'
    })
    expect(installerRequested()).toBe(false)
  })
})
