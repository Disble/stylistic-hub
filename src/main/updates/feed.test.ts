import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUpdateInfo, resolveFiles } from 'electron-updater/out/providers/Provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Component } from '../../shared/signing/documents'
import { startFeed, type Feed } from './feed'

/** The installer's bytes in these tests. */
const INSTALLER = Buffer.from('MZ\u0090 a hub installer, verified before it is served')

/** A temporary folder holding the installer. */
let scratch: string
/** The verified installer on disk. */
let file: string
/** The component.json that pins it. */
let component: Component
/** The feed under test, closed after each test. */
let feed: Feed | undefined

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'stylistic-feed-'))
  file = join(scratch, 'stylistic-hub-0.2.0.exe')
  await writeFile(file, INSTALLER)
  component = {
    id: 'stylistic-hub',
    kind: 'hub',
    version: '0.2.0',
    channel: 'stable',
    sha256: createHash('sha256').update(INSTALLER).digest('hex'),
    size: INSTALLER.length,
    maxUncompressedSize: INSTALLER.length,
    requires: {},
    provides: {},
    releaseNotes: 'https://example.test/notes'
  }
})

afterEach(async () => {
  await feed?.close()
  feed = undefined
  await rm(scratch, { recursive: true, force: true })
})

/** GETs `path` from the feed. */
async function get(path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, feed?.url), init)
}

describe('startFeed', () => {
  it('serves on 127.0.0.1 a latest.yml that electron-updater resolves to the verified file and its sha512', async () => {
    feed = await startFeed({ file, component })
    expect(feed.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)

    // electron-updater asks for latest.yml with a cache-busting query (util.js newUrlFromBase).
    const response = await get('latest.yml?noCache=1abc')
    expect(response.status).toBe(200)
    const info = parseUpdateInfo(await response.text(), 'latest.yml', new URL('latest.yml', feed.url))
    const sha512 = createHash('sha512').update(INSTALLER).digest('base64')
    expect(info).toMatchObject({
      version: '0.2.0',
      path: 'stylistic-hub-0.2.0.exe',
      sha512,
      files: [{ url: 'stylistic-hub-0.2.0.exe', sha512, size: INSTALLER.length }]
    })
    const [resolved] = resolveFiles(info, new URL(feed.url))
    expect(resolved?.url.href).toBe(`${feed.url}stylistic-hub-0.2.0.exe`)

    const download = await fetch(resolved?.url ?? '')
    expect(download.status).toBe(200)
    expect(Buffer.from(await download.arrayBuffer())).toEqual(INSTALLER)
  })

  it('answers 404 to any other path or method', async () => {
    feed = await startFeed({ file, component })
    for (const path of [
      '',
      'latest-mac.yml',
      'stylistic-hub-0.2.0.exe.blockmap',
      'component.json',
      'x.exe'
    ]) {
      expect((await get(path)).status, path).toBe(404)
    }
    expect((await get('latest.yml', { method: 'POST' })).status).toBe(404)
  })

  it('refuses to start when the file on disk is not the verified one', async () => {
    const swapped = Buffer.from(INSTALLER)
    swapped.writeUInt8(swapped.readUInt8(swapped.length - 1) ^ 1, swapped.length - 1)
    await writeFile(file, swapped)
    await expect(startFeed({ file, component })).rejects.toThrow('sha256_mismatch')
    await writeFile(file, INSTALLER.subarray(1))
    await expect(startFeed({ file, component })).rejects.toThrow('size_mismatch')
  })

  it('stops serving once closed', async () => {
    feed = await startFeed({ file, component })
    const { url } = feed
    await feed.close()
    feed = undefined
    await expect(fetch(new URL('latest.yml', url))).rejects.toThrow()
  })
})
