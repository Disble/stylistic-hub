import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, SCHEMA_VERSION, openDatabase } from './database'

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

/** The schema version and recorded minReaderSchema of a migrated database (src/shared/schema-state.ts reads them for the hub). */
function readSchemaState(file: string): { userVersion: number; minReaderSchema: number } {
  const raw = new DatabaseSync(file, { readOnly: true })
  const { value } = raw.prepare('SELECT min_reader_schema AS value FROM schema_meta').get() as {
    value: number
  }
  raw.close()
  return { userVersion: userVersion(file), minReaderSchema: value }
}

/** Writes a database as a newer hub would: a higher user_version and its own minReaderSchema. */
function writeNewerDatabase(file: string, version: number, minReaderSchema: number): void {
  openDatabase(file).close()
  const raw = new DatabaseSync(file)
  raw.exec(`UPDATE schema_meta SET min_reader_schema = ${minReaderSchema}; PRAGMA user_version = ${version};`)
  raw.close()
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
    expect(userVersion(file)).toBe(4)
  })

  it('refuses a database written by a newer hub', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    raw.exec('PRAGMA user_version = 999')
    raw.close()

    expect(() => openDatabase(file)).toThrow(/newer/)
  })

  it('opens a newer database whose minReaderSchema this hub meets, leaving it as it was', () => {
    const file = join(dir, 'stylistic.db')
    writeNewerDatabase(file, SCHEMA_VERSION + 2, SCHEMA_VERSION)

    const db = openDatabase(file)
    db.close()

    expect(readSchemaState(file)).toEqual({
      userVersion: SCHEMA_VERSION + 2,
      minReaderSchema: SCHEMA_VERSION
    })
    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('refuses a newer database whose minReaderSchema is above this hub, naming both numbers', () => {
    const file = join(dir, 'stylistic.db')
    writeNewerDatabase(file, SCHEMA_VERSION + 2, SCHEMA_VERSION + 1)

    expect(() => openDatabase(file)).toThrow(/newer/)
    expect(() => openDatabase(file)).toThrow(`readable from schema ${SCHEMA_VERSION + 1}`)
    expect(() => openDatabase(file)).toThrow(`this hub reads schema ${SCHEMA_VERSION}`)
  })

  it('records minReaderSchema in a new database: the 0.0.1 schemas are contracts, analysis_part an expand', () => {
    const file = join(dir, 'stylistic.db')

    openDatabase(file).close()

    expect(SCHEMA_VERSION).toBe(4)
    expect(MIGRATIONS.map((m) => m.kind)).toEqual(['contract', 'contract', 'contract', 'expand'])
    expect(readSchemaState(file)).toEqual({ userVersion: 4, minReaderSchema: 3 })
  })

  it('takes no backup of a brand-new database or of one with no migration pending', () => {
    const file = join(dir, 'stylistic.db')

    openDatabase(file).close()
    openDatabase(file).close()

    expect(existsSync(join(dir, 'backups'))).toBe(false)
  })

  it('backs up the database with VACUUM INTO before migrating it', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    raw.exec(MIGRATIONS[0]!.sql)
    raw.exec(MIGRATIONS[1]!.sql)
    raw.exec(
      `INSERT INTO document VALUES ('doc', 'Sofía', 'general', '{}', '# Perfil'); PRAGMA user_version = 2;`
    )
    raw.close()

    openDatabase(file).close()

    const backups = readdirSync(join(dir, 'backups'))
    expect(backups).toHaveLength(1)
    expect(backups[0]).toMatch(/^stylistic-schema2-\d{14}\.db$/)
    const backup = new DatabaseSync(join(dir, 'backups', backups[0]!), { readOnly: true })
    expect(backup.prepare('SELECT document_key, title FROM document').all()).toEqual([
      { document_key: 'doc', title: 'Sofía' }
    ])
    expect(backup.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 })
    backup.close()
    expect(readSchemaState(file)).toEqual({ userVersion: 4, minReaderSchema: 3 })
  })

  it('opens a 0.0.1 database, backs it up, keeps every row and reports minReaderSchema 3', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    for (const migration of MIGRATIONS.slice(0, 3)) raw.exec(migration.sql)
    raw.exec(`INSERT INTO document VALUES ('doc', 'Sofía', 'general', '{}', '# Perfil', '2026-01-01');
    INSERT INTO preferences VALUES (1, 'Respeta el voseo');
    INSERT INTO analysis VALUES ('a1', 'doc', 'completed', 'updated', 'run', '2026-01-01', '2026-01-02');
    INSERT INTO analysis_chunk VALUES ('a1', 'c1', 0, 'completed', 1, 1, 0, NULL);
    INSERT INTO suggestion VALUES ('s1', 'a1', 'c1', 0, 0, '{}');
    INSERT INTO feedback VALUES ('f1', 's1', 'accept', NULL, 'completed', 'updated', NULL, NULL, '2026-01-02');
    PRAGMA user_version = 3;`)
    raw.close()

    const db = openDatabase(file)
    const counts = ['document', 'preferences', 'analysis', 'analysis_chunk', 'suggestion', 'feedback'].map(
      (table) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
    )
    db.close()

    expect(counts).toEqual([1, 1, 1, 1, 1, 1])
    expect(readSchemaState(file)).toEqual({ userVersion: 4, minReaderSchema: 3 })
    expect(existsSync(join(dir, 'backups'))).toBe(true)
  })

  it('uses WAL', () => {
    const db = openDatabase(join(dir, 'stylistic.db'))

    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
    db.close()
  })
})

/**
 * Statements an expand migration must not contain: they break what the previous release reads. Any DROP counts,
 * since SQLite accepts `ALTER TABLE t DROP b` without the COLUMN keyword.
 */
const CONTRACT_ONLY = /\bDROP\b|\bRENAME\b|\bALTER\s+COLUMN\b/i

describe('expand/contract rule', () => {
  it('flags the statements that break the previous release, case-insensitively', () => {
    expect(CONTRACT_ONLY.test('ALTER TABLE document drop column title')).toBe(true)
    expect(CONTRACT_ONLY.test('drop table preferences')).toBe(true)
    expect(CONTRACT_ONLY.test('ALTER TABLE document Rename TO doc')).toBe(true)
    expect(CONTRACT_ONLY.test('ALTER TABLE document alter column title')).toBe(true)
    expect(CONTRACT_ONLY.test('ALTER TABLE t DROP b')).toBe(true)
    expect(CONTRACT_ONLY.test('ALTER TABLE document ADD COLUMN x TEXT; CREATE TABLE y (id TEXT)')).toBe(false)
  })

  it('no migration marked expand drops, renames or alters what the previous release reads', () => {
    const offending = MIGRATIONS.filter((m) => m.kind === 'expand' && CONTRACT_ONLY.test(m.sql))

    expect(offending).toEqual([])
  })
})
