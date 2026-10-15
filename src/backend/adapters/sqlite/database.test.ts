import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'

/** Fresh folder for each test's database file. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-db-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Reads SQLite's schema version from a file without migrating it. */
function userVersion(file: string): number {
  const raw = new DatabaseSync(file)
  const { user_version } = raw.prepare('PRAGMA user_version').get() as { user_version: number }
  raw.close()
  return user_version
}

describe('openDatabase', () => {
  it('creates the file and applies every migration, recording the version', () => {
    const file = join(dir, 'stylistic.db')

    openDatabase(file).close()

    expect(userVersion(file)).toBeGreaterThanOrEqual(1)
  })

  it('opens an up-to-date database without migrating it again', () => {
    const file = join(dir, 'stylistic.db')
    openDatabase(file).close()
    const version = userVersion(file)

    const db = openDatabase(file)
    db.close()

    expect(userVersion(file)).toBe(version)
  })

  it('refuses a database written by a newer hub', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 999')
    raw.close()

    expect(() => openDatabase(file)).toThrow(/newer/)
  })

  it('enforces foreign keys and uses WAL', () => {
    const db = openDatabase(join(dir, 'stylistic.db'))

    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
  })
})
