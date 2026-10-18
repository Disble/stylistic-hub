import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  Analysis,
  AnalysisStatus,
  ChunkStatus,
  ProfileStatus,
  Suggestion
} from '../../analysis/analysis'
import type { WorkflowSuggestion } from '../../analysis/schemas'
import type { AnalysisRepository, NewAnalysis, StoredSuggestion } from '../../ports/analysis-repository'

/** A row of the `analysis` table. */
interface AnalysisRow {
  id: string
  document_key: string
  status: AnalysisStatus
  profile_status: ProfileStatus
  run_id: string | null
  created_at: string
  finished_at: string | null
}

/** A row of the `analysis_chunk` table. */
interface ChunkRow {
  chunk_id: string
  status: ChunkStatus
  dropped: number
  error: string | null
}

/** A row of the `suggestion` table. */
interface SuggestionRow {
  id: string
  chunk_id: string
  body: string
}

/**
 * The add-in writes a suggestion's id into Word content-control tags that outlive the analysis, so
 * ids must be unique for good, tag-safe (`[0-9a-f]`) and short: 64 random bits, 16 characters.
 */
function suggestionId(): string {
  return randomBytes(8).toString('hex')
}

/** Analyses kept in the hub's SQLite database; every write checks the analysis is still running. */
export class SqliteAnalysisRepository implements AnalysisRepository {
  constructor(private readonly db: DatabaseSync) {}

  create({ id, documentId, chunks }: NewAnalysis): Analysis {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO analysis (id, document_key, status, profile_status, created_at)
           VALUES (?, ?, 'running', 'pending', ?)`
        )
        .run(id, documentId, new Date().toISOString())
      const chunk = this.db.prepare(
        `INSERT INTO analysis_chunk (analysis_id, chunk_id, position, status, parts_total)
         VALUES (?, ?, ?, 'queued', ?)`
      )
      chunks.forEach((c, position) => chunk.run(id, c.id, position, c.parts))
    })
    return this.get(id) as Analysis
  }

  get(id: string): Analysis | undefined {
    const row = this.db.prepare('SELECT * FROM analysis WHERE id = ?').get(id) as AnalysisRow | undefined
    if (!row) return undefined
    const chunks = this.db
      .prepare(
        'SELECT chunk_id, status, dropped, error FROM analysis_chunk WHERE analysis_id = ? ORDER BY position'
      )
      .all(id) as unknown as ChunkRow[]
    const suggestions = this.db
      .prepare(
        'SELECT id, chunk_id, body FROM suggestion WHERE analysis_id = ? ORDER BY chunk_id, part, position'
      )
      .all(id) as unknown as SuggestionRow[]
    return {
      id: row.id,
      documentId: row.document_key,
      status: row.status,
      profile: row.profile_status,
      createdAt: row.created_at,
      ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
      chunks: chunks.map((c) => ({
        id: c.chunk_id,
        status: c.status,
        dropped: c.dropped,
        ...(c.error ? { error: c.error } : {}),
        suggestions: suggestions
          .filter((s) => s.chunk_id === c.chunk_id)
          .map((s) => ({ ...(JSON.parse(s.body) as WorkflowSuggestion), id: s.id }))
      }))
    }
  }

  setRunId(id: string, runId: string): void {
    this.db.prepare('UPDATE analysis SET run_id = ? WHERE id = ?').run(runId, id)
  }

  runId(id: string): string | undefined {
    const row = this.db.prepare('SELECT run_id FROM analysis WHERE id = ?').get(id) as
      { run_id: string | null } | undefined
    return row?.run_id ?? undefined
  }

  startChunk(id: string, chunkId: string): boolean {
    if (!this.running(id)) return false
    this.db
      .prepare(
        `UPDATE analysis_chunk SET status = 'running' WHERE analysis_id = ? AND chunk_id = ? AND status = 'queued'`
      )
      .run(id, chunkId)
    return true
  }

  /** A part already recorded is ignored, so a save that OpenWorkflow replays changes nothing. */
  completePart(
    id: string,
    chunkId: string,
    part: number,
    suggestions: WorkflowSuggestion[],
    dropped: number
  ): void {
    this.transaction(() => {
      if (!this.running(id)) return
      const { changes } = this.db
        .prepare('INSERT OR IGNORE INTO analysis_part (analysis_id, chunk_id, part) VALUES (?, ?, ?)')
        .run(id, chunkId, part)
      if (changes === 0) return
      const insert = this.db.prepare(
        'INSERT INTO suggestion (id, analysis_id, chunk_id, part, position, body) VALUES (?, ?, ?, ?, ?, ?)'
      )
      suggestions.forEach((s, position) =>
        insert.run(suggestionId(), id, chunkId, part, position, JSON.stringify(s))
      )
      this.db
        .prepare(
          `UPDATE analysis_chunk SET
             parts_done = parts_done + 1,
             dropped = dropped + ?,
             status = CASE WHEN status = 'failed' THEN 'failed'
                           WHEN parts_done + 1 >= parts_total THEN 'completed'
                           ELSE 'running' END
           WHERE analysis_id = ? AND chunk_id = ?`
        )
        .run(dropped, id, chunkId)
    })
  }

  failChunk(id: string, chunkId: string, error: string): void {
    if (!this.running(id)) return
    this.db
      .prepare(
        `UPDATE analysis_chunk SET status = 'failed', error = ? WHERE analysis_id = ? AND chunk_id = ?`
      )
      .run(error, id, chunkId)
  }

  setProfile(id: string, status: ProfileStatus): void {
    this.db
      .prepare(`UPDATE analysis SET profile_status = ? WHERE id = ? AND status = 'running'`)
      .run(status, id)
  }

  finish(id: string): Analysis {
    this.db
      .prepare(
        `UPDATE analysis SET
           finished_at = :now,
           status = CASE
             WHEN NOT EXISTS (SELECT 1 FROM analysis_chunk WHERE analysis_id = :id AND status <> 'completed') THEN 'completed'
             WHEN EXISTS (SELECT 1 FROM analysis_chunk WHERE analysis_id = :id AND status = 'completed') THEN 'partial'
             ELSE 'failed' END
         WHERE id = :id AND status = 'running'`
      )
      .run({ now: new Date().toISOString(), id })
    return this.get(id) as Analysis
  }

  cancel(id: string): boolean {
    return this.stop(id, 'canceled', null)
  }

  fail(id: string, error: string): void {
    this.stop(id, 'failed', error)
  }

  /** Ends a running analysis and its open chunks with `status`; false when it was not running. */
  private stop(id: string, status: 'canceled' | 'failed', error: string | null): boolean {
    let stopped = false
    this.transaction(() => {
      const { changes } = this.db
        .prepare(`UPDATE analysis SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'`)
        .run(status, new Date().toISOString(), id)
      if (changes === 0) return
      this.db
        .prepare(
          `UPDATE analysis_chunk SET status = ?, error = ? WHERE analysis_id = ? AND status IN ('queued', 'running')`
        )
        .run(status, error, id)
      stopped = true
    })
    return stopped
  }

  suggestion(id: string): StoredSuggestion | undefined {
    const row = this.db
      .prepare(
        `SELECT s.body, a.document_key FROM suggestion s JOIN analysis a ON a.id = s.analysis_id WHERE s.id = ?`
      )
      .get(id) as { body: string; document_key: string } | undefined
    if (!row) return undefined
    const suggestion: Suggestion = { ...(JSON.parse(row.body) as WorkflowSuggestion), id }
    return { suggestion, documentId: row.document_key }
  }

  /** Whether the analysis still takes writes. */
  private running(id: string): boolean {
    const row = this.db.prepare('SELECT status FROM analysis WHERE id = ?').get(id) as
      { status: string } | undefined
    return row?.status === 'running'
  }

  /** Runs `write` in one transaction, so a reader never sees half of it. */
  private transaction(write: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      write()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
