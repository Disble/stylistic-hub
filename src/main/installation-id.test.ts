import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installationId } from './installation-id'

/** Fresh folder for each test. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-install-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('installationId', () => {
  it('creates a UUID on first use and returns the same one afterwards', () => {
    const first = installationId(dir)

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(installationId(dir)).toBe(first)
  })

  it('creates the folder when it does not exist yet', () => {
    expect(installationId(join(dir, 'pi'))).toMatch(/^[0-9a-f-]{36}$/)
  })
})
