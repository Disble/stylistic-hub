import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * A schema migration. An `expand` one only adds, so the previous release still reads the database
 * and `minReaderSchema` stays; a `contract` one may break it, so it raises `minReaderSchema` to its
 * own version (docs/architecture.md, D7).
 */
interface Migration {
  readonly kind: 'expand' | 'contract'
  readonly sql: string
}

/**
 * Schema migrations, applied in order; the array index plus one is the `user_version` it leaves.
 * Append only: never edit a migration that has shipped.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    kind: 'contract',
    sql: `CREATE TABLE document (
    document_key TEXT PRIMARY KEY,
    title TEXT,
    genre TEXT NOT NULL
      CHECK (genre IN ('narrativa-literaria', 'ensayo-academico', 'periodismo-cultural', 'general')),
    processing_config TEXT NOT NULL
      CHECK (json_valid(processing_config) AND json_type(processing_config) = 'object'),
    profile_markdown TEXT NOT NULL
  ) STRICT`
  },
  {
    kind: 'contract',
    sql: `CREATE TABLE preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    correction_instructions TEXT CHECK (length(correction_instructions) <= 4000)
  ) STRICT`
  },
  // API v1: the analyses the add-in starts, their chunks and suggestions, and the feedback on them.
  {
    kind: 'contract',
    sql: `ALTER TABLE document ADD COLUMN profile_updated_at TEXT;
  CREATE TABLE analysis (
    id TEXT PRIMARY KEY,
    document_key TEXT NOT NULL REFERENCES document (document_key),
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed', 'canceled')),
    profile_status TEXT NOT NULL CHECK (profile_status IN ('pending', 'updated', 'unchanged', 'failed')),
    run_id TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  ) STRICT;
  CREATE TABLE analysis_chunk (
    analysis_id TEXT NOT NULL REFERENCES analysis (id),
    chunk_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
    parts_total INTEGER NOT NULL CHECK (parts_total > 0),
    parts_done INTEGER NOT NULL DEFAULT 0,
    dropped INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    PRIMARY KEY (analysis_id, chunk_id)
  ) STRICT;
  CREATE TABLE suggestion (
    id TEXT PRIMARY KEY,
    analysis_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    position INTEGER NOT NULL,
    body TEXT NOT NULL CHECK (json_valid(body)),
    FOREIGN KEY (analysis_id, chunk_id) REFERENCES analysis_chunk (analysis_id, chunk_id)
  ) STRICT;
  CREATE INDEX suggestion_by_chunk ON suggestion (analysis_id, chunk_id, part, position);
  CREATE TABLE feedback (
    id TEXT PRIMARY KEY,
    suggestion_id TEXT NOT NULL REFERENCES suggestion (id),
    action TEXT NOT NULL CHECK (action IN ('accept', 'reject')),
    comment TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
    outcome TEXT CHECK (outcome IN ('updated', 'ignored', 'acknowledged')),
    summary TEXT,
    error TEXT,
    created_at TEXT NOT NULL
  ) STRICT`
  },
  // The parts already recorded, so a part whose save OpenWorkflow replays is recorded once. Expand: a new
  // table that schema-3 servers never read, so they can still open the database (minReaderSchema stays 3).
  {
    kind: 'expand',
    sql: `CREATE TABLE analysis_part (
    analysis_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    PRIMARY KEY (analysis_id, chunk_id, part),
    FOREIGN KEY (analysis_id, chunk_id) REFERENCES analysis_chunk (analysis_id, chunk_id)
  ) STRICT`
  }
]

/** The schema this server writes: the number of migrations. */
export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Opens the hub database, creating and migrating it as needed. Before migrating an existing
 * database it is backed up with `VACUUM INTO` (consistent under WAL) into `backups/` beside it.
 * Custom code: node:sqlite has no migration helper and the schema is a handful of statements
 * (see docs/architecture.md).
 */
export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode = WAL')
    backUpBeforeMigrating(db, file)
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** SQLite's `user_version`: how many migrations the database has seen. */
function userVersionOf(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

/** Backs up an existing database that has migrations pending; a new one has nothing to protect. */
function backUpBeforeMigrating(db: DatabaseSync, file: string): void {
  const current = userVersionOf(db)
  if (current === 0 || current >= SCHEMA_VERSION) return
  const dir = join(dirname(file), 'backups')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const target = join(dir, `stylistic-schema${current}-${stamp}.db`)
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`)
}

/**
 * Returns the database's `minReaderSchema`, creating `schema_meta` and backfilling it as the current
 * `user_version` when missing (a 0.0.1 database). Outside the migrations, so `user_version` still
 * counts only migrations.
 */
function minReaderSchemaOf(db: DatabaseSync, current: number): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    min_reader_schema INTEGER NOT NULL
  ) STRICT`)
  db.prepare('INSERT OR IGNORE INTO schema_meta (id, min_reader_schema) VALUES (1, ?)').run(current)
  return (db.prepare('SELECT min_reader_schema AS value FROM schema_meta').get() as { value: number }).value
}

/**
 * Applies the migrations the file has not seen, each in its own write transaction. The version is
 * read inside the transaction, so two processes opening the file at once cannot both migrate it.
 * A newer database opens when this server's schema is at least its `minReaderSchema`.
 */
function migrate(db: DatabaseSync): void {
  for (;;) {
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = userVersionOf(db)
      const minReaderSchema = minReaderSchemaOf(db, current)
      if (current > SCHEMA_VERSION && SCHEMA_VERSION < minReaderSchema) {
        throw new Error(
          `The database was written by a newer Stylistic Hub (schema ${current}, readable from schema ` +
            `${minReaderSchema}); this hub reads schema ${SCHEMA_VERSION}. Update the hub.`
        )
      }
      const next = MIGRATIONS[current]
      if (next === undefined) {
        db.exec('COMMIT')
        return
      }
      db.exec(next.sql)
      if (next.kind === 'contract') db.exec(`UPDATE schema_meta SET min_reader_schema = ${current + 1}`)
      db.exec(`PRAGMA user_version = ${current + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
