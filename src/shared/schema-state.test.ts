import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSchemaState, restoreBackup } from './schema-state'

/** Fresh folder for each test's database file. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-schema-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('readSchemaState', () => {
  it('reads minReaderSchema as the database records it', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    raw.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE schema_meta (id INTEGER PRIMARY KEY, min_reader_schema INTEGER NOT NULL);
    INSERT INTO schema_meta VALUES (1, 1); PRAGMA user_version = 4;`)
    raw.close()

    expect(readSchemaState(file)).toEqual({ userVersion: 4, minReaderSchema: 1 })
  })

  it('reads a 0.0.1 database as minReaderSchema = user_version, without changing the file', () => {
    const file = join(dir, 'stylistic.db')
    const raw = new DatabaseSync(file)
    raw.exec('CREATE TABLE document (document_key TEXT PRIMARY KEY); PRAGMA user_version = 1;')
    raw.close()
    const before = readFileSync(file)

    expect(readSchemaState(file)).toEqual({ userVersion: 1, minReaderSchema: 1 })
    expect(readFileSync(file).equals(before)).toBe(true)
  })

  it('does not create a missing database', () => {
    const file = join(dir, 'missing.db')

    expect(() => readSchemaState(file)).toThrow()
    expect(existsSync(file)).toBe(false)
  })
})

describe('restoreBackup', () => {
  it('copies the backup over the database and removes the stale -wal and -shm files', () => {
    const file = join(dir, 'stylistic.db')
    const backupFile = join(dir, 'backup.db')
    const raw = new DatabaseSync(file)
    raw.exec(`CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('before')`)
    raw.exec(`VACUUM INTO '${backupFile.replaceAll("'", "''")}'`)
    raw.exec(`INSERT INTO t VALUES ('after')`)
    raw.close()
    writeFileSync(`${file}-wal`, 'stale')
    writeFileSync(`${file}-shm`, 'stale')

    restoreBackup(file, backupFile)

    expect(existsSync(`${file}-wal`)).toBe(false)
    expect(existsSync(`${file}-shm`)).toBe(false)
    const restored = new DatabaseSync(file)
    expect(restored.prepare('SELECT v FROM t').all()).toEqual([{ v: 'before' }])
    restored.close()
  })
})
