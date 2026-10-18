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
  ) STRICT`,
  `CREATE TABLE preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    correction_instructions TEXT CHECK (length(correction_instructions) <= 4000)
  ) STRICT`,
  // API v1: the analyses the add-in starts, their chunks and suggestions, and the feedback on them.
  `ALTER TABLE document ADD COLUMN profile_updated_at TEXT;
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
  ) STRICT`,
  // The parts already recorded, so a part whose save OpenWorkflow replays is recorded once.
  `CREATE TABLE analysis_part (
    analysis_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    part INTEGER NOT NULL,
    PRIMARY KEY (analysis_id, chunk_id, part),
    FOREIGN KEY (analysis_id, chunk_id) REFERENCES analysis_chunk (analysis_id, chunk_id)
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
