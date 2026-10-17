import type { DatabaseSync } from 'node:sqlite'
import type { Feedback, FeedbackOutcome, FeedbackStatus } from '../../feedback/feedback'
import type { FeedbackRepository, NewFeedback } from '../../ports/feedback-repository'

/** A row of the `feedback` table. */
interface FeedbackRow {
  id: string
  suggestion_id: string
  action: Feedback['action']
  comment: string | null
  status: FeedbackStatus
  outcome: FeedbackOutcome | null
  summary: string | null
  error: string | null
  created_at: string
}

/** Feedback kept in the hub's SQLite database. */
export class SqliteFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: DatabaseSync) {}

  create({ id, suggestionId, action, comment }: NewFeedback): Feedback {
    this.db
      .prepare(
        `INSERT INTO feedback (id, suggestion_id, action, comment, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, suggestionId, action, comment ?? null, new Date().toISOString())
    return this.get(id) as Feedback
  }

  get(id: string): Feedback | undefined {
    const row = this.db.prepare('SELECT * FROM feedback WHERE id = ?').get(id) as FeedbackRow | undefined
    if (!row) return undefined
    return {
      id: row.id,
      suggestionId: row.suggestion_id,
      action: row.action,
      status: row.status,
      createdAt: row.created_at,
      ...(row.comment === null ? {} : { comment: row.comment }),
      ...(row.outcome === null ? {} : { outcome: row.outcome }),
      ...(row.summary === null ? {} : { summary: row.summary }),
      ...(row.error === null ? {} : { error: row.error })
    }
  }

  complete(id: string, outcome: FeedbackOutcome, summary?: string): void {
    this.db
      .prepare(`UPDATE feedback SET status = 'completed', outcome = ?, summary = ? WHERE id = ?`)
      .run(outcome, summary ?? null, id)
  }

  fail(id: string, error: string): void {
    this.db.prepare(`UPDATE feedback SET status = 'failed', error = ? WHERE id = ?`).run(error, id)
  }
}
