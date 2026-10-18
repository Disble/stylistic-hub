import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { envelope, makeRelease, makeWorld, type Release, type World } from './test-fixtures'
import { patchName } from './zip-fixtures'

/** The current test's world. */
let world: World
/** Server 1.0.0, installed before each test. */
let first: Release
/** Server 1.1.0, the update each test tries. */
let next: Release

beforeEach(async () => {
  world = await makeWorld()
  first = await makeRelease({ version: '1.0.0' }, world.componentKey)
  next = await makeRelease({ version: '1.1.0' }, world.componentKey)
  world.publish({ releases: [first], serial: 100 })
  await world.engine.runCheck()
})

afterEach(async () => {
  await rm(join(world.root, '..'), { recursive: true, force: true })
})

/** A path under the server component's folder. */
function server(...parts: string[]): string {
  return join(world.root, 'server', ...parts)
}

/** Publishes `release` at a new serial and runs a full check; returns the single install outcome. */
async function update(release: Release, serial = 101) {
  world.publish({ releases: [release], serial })
  const report = await world.engine.runCheck()
  expect(report.catalog).toBe('ok')
  return report.installs[0]?.outcome
}

/** Asserts that 1.0.0 is still current and on disk, and the last history line is this failure. */
async function expectFailedKeepingFirst(reason: string): Promise<void> {
  const state = await world.engine.readState()
  expect(state.components['server']).toMatchObject({ current: '1.0.0', previous: null })
  expect(await readFile(server('1.0.0', 'entry.js'), 'utf8')).toBe("console.log('server 1.0.0')")
  expect(state.history.at(-1)).toMatchObject({
    component: 'server',
    from: '1.0.0',
    to: '1.1.0',
    outcome: 'failed',
    reason
  })
  expect(existsSync(server('1.1.0'))).toBe(false)
}

/** Whether the zip of 1.1.0 was requested. */
function zipRequested(): boolean {
  return world.seen.some((request) => request.url === next.entry.artifactUrl)
}

describe('installComponent', () => {
  it('installs 1.0.0 with its record, its key and a history line, and leaves no staging', async () => {
    const state = await world.engine.readState()
    expect(state.components['server']).toEqual({
      current: '1.0.0',
      previous: null,
      bad: [],
      keyId: world.componentKey.id
    })
    expect(state.history).toEqual([
      {
        time: '2026-10-18T12:00:00.000Z',
        component: 'server',
        from: null,
        to: '1.0.0',
        outcome: 'installed',
        reason: null
      }
    ])
    expect(JSON.parse(await readFile(server('1.0.0.json'), 'utf8')).component).toEqual(first.component)
    expect((await readdir(server())).sort()).toEqual(['1.0.0', '1.0.0.json'])
  })

  it('moves from A to B keeping A as previous, then to C deleting A', async () => {
    expect(await update(next)).toEqual({ status: 'installed' })
    expect((await world.engine.readState()).components['server']).toMatchObject({
      current: '1.1.0',
      previous: '1.0.0'
    })

    const third = await makeRelease({ version: '1.2.0' }, world.componentKey)
    expect(await update(third, 102)).toEqual({ status: 'installed' })

    const state = await world.engine.readState()
    expect(state.components['server']).toMatchObject({ current: '1.2.0', previous: '1.1.0' })
    expect((await readdir(server())).sort()).toEqual(['1.1.0', '1.1.0.json', '1.2.0', '1.2.0.json'])
    expect(await readFile(server('1.2.0', 'entry.js'), 'utf8')).toBe("console.log('server 1.2.0')")
    expect(state.history.map((line) => [line.to, line.outcome])).toEqual([
      ['1.0.0', 'installed'],
      ['1.1.0', 'installed'],
      ['1.2.0', 'installed']
    ])
  })

  it('recovers from a hub killed after extraction, before the state switch', async () => {
    // What a crash leaves: the complete zip, a half-extracted staging folder, a renamed folder the state never
    // pointed at, and a stale zip of another version.
    await mkdir(server('.staging', '1.1.0'), { recursive: true })
    await writeFile(server('.staging', '1.1.0.zip'), next.zip)
    await writeFile(server('.staging', '1.1.0', 'half.js'), 'partial')
    await writeFile(server('.staging', '0.9.0.zip'), 'stale')
    await mkdir(server('1.1.0'), { recursive: true })
    await writeFile(server('1.1.0', 'leftover.js'), 'from the crashed run')
    expect((await world.engine.readState()).components['server']?.current).toBe('1.0.0')

    expect(await update(next)).toEqual({ status: 'installed' })

    expect(zipRequested()).toBe(false)
    expect((await world.engine.readState()).components['server']).toMatchObject({
      current: '1.1.0',
      previous: '1.0.0'
    })
    expect(await readdir(server('1.1.0'))).toEqual(['entry.js'])
    expect(existsSync(server('.staging'))).toBe(false)
  })

  it('resumes a download cut by a killed hub or a dropped connection with a Range request', async () => {
    const half = Math.floor(next.zip.length / 2)
    world.publish({ releases: [next], serial: 101 })
    world.routes.set(next.entry.artifactUrl, { breakAfter: half, data: next.zip })

    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'network'
    })
    await expectFailedKeepingFirst('network')
    expect((await readFile(server('.staging', '1.1.0.zip'))).length).toBe(half)

    world.routes.set(next.entry.artifactUrl, next.zip)
    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({ status: 'installed' })

    expect(world.seen.filter((request) => request.url === next.entry.artifactUrl).at(-1)?.range).toBe(
      `bytes=${half}-`
    )
    expect(await readFile(server('1.1.0', 'entry.js'), 'utf8')).toBe("console.log('server 1.1.0')")
  })

  it('starts over when the server answers a Range request with the whole file', async () => {
    await mkdir(server('.staging'), { recursive: true })
    await writeFile(server('.staging', '1.1.0.zip'), next.zip.subarray(0, 10))
    world.publish({ releases: [next], serial: 101 })
    world.routes.set(next.entry.artifactUrl, { ignoreRange: next.zip })

    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({ status: 'installed' })
    expect(await readFile(server('1.1.0', 'entry.js'), 'utf8')).toBe("console.log('server 1.1.0')")
  })

  it('rejects a corrupt download by its sha256 and deletes it so the next check starts over', async () => {
    const corrupt = Buffer.from(next.zip)
    corrupt[40] = corrupt[40]! ^ 0xff
    world.publish({ releases: [next], serial: 101 })
    world.routes.set(next.entry.artifactUrl, corrupt)

    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'sha256_mismatch'
    })
    await expectFailedKeepingFirst('sha256_mismatch')
    expect(existsSync(server('.staging', '1.1.0.zip'))).toBe(false)
  })

  it('rejects a component.json whose signature does not match, before downloading the zip', async () => {
    next.envelopeText = JSON.stringify(envelope({ forged: true }, world.componentKey))

    expect(await update(next)).toEqual({ status: 'failed', reason: 'bad_signature' })
    await expectFailedKeepingFirst('bad_signature')
    expect(zipRequested()).toBe(false)
  })

  it.each([
    ['id', { id: 'other-server' }],
    ['kind', { kind: 'module' }],
    ['version', { version: '9.9.9' }],
    ['channel', { channel: 'beta' as const }],
    ['sha256', { sha256: '0'.repeat(64) }]
  ])(
    'rejects a component.json whose %s differs from the catalog entry, before extraction',
    async (_field, change) => {
      const bound = await makeRelease({ version: '1.1.0', component: change }, world.componentKey)

      expect(await update(bound)).toEqual({ status: 'failed', reason: 'binding_mismatch' })
      await expectFailedKeepingFirst('binding_mismatch')
      expect(existsSync(server('.staging', '1.1.0'))).toBe(false)
      expect(zipRequested()).toBe(false)
    }
  )

  it('rejects a zip with a malicious entry and removes the partial staging folder', async () => {
    const zip = patchName(
      (
        await makeRelease(
          { version: '1.1.0', items: [{ name: 'xx/evil.js', data: 'pwned' }] },
          world.componentKey
        )
      ).zip,
      'xx/evil.js',
      '../evil.js'
    )
    const malicious = await makeRelease({ version: '1.1.0', zip, maxUncompressedSize: 5 }, world.componentKey)

    expect(await update(malicious)).toEqual({ status: 'failed', reason: 'bad_zip' })
    await expectFailedKeepingFirst('bad_zip')
    expect(existsSync(server('.staging', '1.1.0'))).toBe(false)
    expect(existsSync(server('evil.js'))).toBe(false)
  })

  it('reports a component.json that cannot be fetched or parsed, and a zip that cannot be fetched', async () => {
    world.publish({ releases: [next], serial: 101 })
    world.routes.delete(next.entry.componentUrl)
    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'network'
    })

    world.routes.set(next.entry.componentUrl, 'not json')
    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'invalid_document'
    })

    world.routes.set(next.entry.componentUrl, next.componentText)
    world.routes.set(next.entry.artifactUrl, { status: 503 })
    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'network'
    })

    world.routes.set(next.entry.artifactUrl, { error: true })
    expect((await world.engine.runCheck()).installs[0]?.outcome).toEqual({
      status: 'failed',
      reason: 'network'
    })
    await expectFailedKeepingFirst('network')
  })

  it('refuses to reinstall the current version', async () => {
    const check = await world.engine.checkCatalog()
    if (check.status !== 'ok') throw new Error(check.reason)

    expect(await world.engine.installComponent(first.entry, check.keys)).toEqual({
      status: 'failed',
      reason: 'already_installed'
    })
    expect(await readFile(server('1.0.0', 'entry.js'), 'utf8')).toBe("console.log('server 1.0.0')")
  })
})
