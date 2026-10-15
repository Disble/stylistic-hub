import { DatabaseSync } from 'node:sqlite'

/**
 * Schema migrations, applied in order; the array index plus one is the `user_version` it leaves.
 * Append only: never edit a migration that has shipped.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE document (
    document_key TEXT PRIMARY KEY,
    title TEXT,
    genre TEXT NOT NULL
      CHECK (genre IN ('narrativa-literaria', 'ensayo-academico', 'periodismo-cultural', 'general')),
    processing_config TEXT NOT NULL
      CHECK (json_valid(processing_config) AND json_type(processing_config) = 'object'),
    profile_markdown TEXT NOT NULL
  ) STRICT`
]

/**
 * Opens the hub database, creating and migrating it as needed.
 * Custom code: node:sqlite has no migration helper and the schema is a handful of statements
 * (see docs/architecture.md).
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/**
 * Applies the migrations the file has not seen, each in its own write transaction. The version is
 * read inside the transaction, so two processes opening the file at once cannot both migrate it.
 */
function migrate(db: DatabaseSync): void {
  for (;;) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
      if (current > MIGRATIONS.length) {
        throw new Error(
          `The database was written by a newer Stylistic Hub (schema ${current}); update the hub.`
        )
      }
      const next = MIGRATIONS[current]
      if (next === undefined) {
        db.exec('COMMIT')
        return
      }
      db.exec(next)
      db.exec(`PRAGMA user_version = ${current + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
