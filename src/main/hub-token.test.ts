import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOrCreateHubToken } from './hub-token'

/** Fresh folder for each test. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-token-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadOrCreateHubToken', () => {
  it('creates a 256-bit hex token and stores it', () => {
    const file = join(dir, 'hub-token')

    const token = loadOrCreateHubToken(file)

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(readFileSync(file, 'utf8')).toBe(token)
  })

  it('returns the stored token on later starts', () => {
    const file = join(dir, 'hub-token')
    const first = loadOrCreateHubToken(file)

    expect(loadOrCreateHubToken(file)).toBe(first)
  })

  it('replaces a stored value that is not a valid token', () => {
    const file = join(dir, 'hub-token')
    writeFileSync(file, 'short')

    const token = loadOrCreateHubToken(file)

    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(token).not.toBe('short')
  })

  it('creates two different tokens for two installs', () => {
    expect(loadOrCreateHubToken(join(dir, 'a'))).not.toBe(loadOrCreateHubToken(join(dir, 'b')))
  })
})
