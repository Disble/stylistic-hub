// The hub's read-only view of the server's database (odd/tasks/update-engine.md S1, S3): the main process
// reads a database's schema state and restores a backup on rollback, without importing backend code.
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

/**
 * Reads a database's schema version and `minReaderSchema` without opening it for writing. A
 * database from before `schema_meta` (0.0.1) reads as `minReaderSchema` = its `user_version`.
 */
export function readSchemaState(file: string): { userVersion: number; minReaderSchema: number } {
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    const { user_version: userVersion } = db.prepare('PRAGMA user_version').get() as { user_version: number }
    const hasMeta = db.prepare(`SELECT 1 FROM sqlite_schema WHERE name = 'schema_meta'`).get() !== undefined
    const row = hasMeta
      ? (db.prepare('SELECT min_reader_schema AS value FROM schema_meta').get() as
          { value: number } | undefined)
      : undefined
    return { userVersion, minReaderSchema: row?.value ?? userVersion }
  } finally {
    db.close()
  }
}

/**
 * Puts a backup back in place of the database, which must be closed. The stale `-wal` and `-shm`
 * files go first so SQLite never replays them over the restored file.
 */
export function restoreBackup(file: string, backup: string): void {
  rmSync(`${file}-wal`, { force: true })
  rmSync(`${file}-shm`, { force: true })
  copyFileSync(backup, file)
}
