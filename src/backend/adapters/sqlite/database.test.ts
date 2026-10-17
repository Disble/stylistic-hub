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

  it('upgrades a database from before API v1 and keeps its documents and preferences', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    // The schema the hub shipped before API v1 (user_version 2).
    raw.exec(`CREATE TABLE document (
      document_key TEXT PRIMARY KEY, title TEXT,
      genre TEXT NOT NULL CHECK (genre IN ('narrativa-literaria', 'ensayo-academico', 'periodismo-cultural', 'general')),
      processing_config TEXT NOT NULL CHECK (json_valid(processing_config) AND json_type(processing_config) = 'object'),
      profile_markdown TEXT NOT NULL) STRICT;
    CREATE TABLE preferences (id INTEGER PRIMARY KEY CHECK (id = 1),
      correction_instructions TEXT CHECK (length(correction_instructions) <= 4000)) STRICT;
    INSERT INTO document VALUES ('doc', 'Sofía', 'narrativa-literaria', '{}', '# Perfil');
    INSERT INTO preferences VALUES (1, 'Respeta el voseo');
    PRAGMA user_version = 2;`)
    raw.close()

    const db = openDatabase(file)

    expect(
      db.prepare('SELECT document_key, genre, profile_markdown, profile_updated_at FROM document').all()
    ).toEqual([
      {
        document_key: 'doc',
        genre: 'narrativa-literaria',
        profile_markdown: '# Perfil',
        profile_updated_at: null
      }
    ])
    expect(db.prepare('SELECT correction_instructions FROM preferences').get()).toEqual({
      correction_instructions: 'Respeta el voseo'
    })
    expect(db.prepare('SELECT count(*) AS n FROM analysis').get()).toEqual({ n: 0 })
    db.close()
    expect(userVersion(file)).toBe(3)
  })

  it('refuses a database written by a newer hub', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 999')
    raw.close()

    expect(() => openDatabase(file)).toThrow(/newer/)
  })

  it('uses WAL', () => {
    const db = openDatabase(join(dir, 'stylistic.db'))

    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
  })
})
