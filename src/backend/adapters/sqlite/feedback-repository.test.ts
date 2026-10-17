import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAnalysisRepository } from './analysis-repository'
import { openDatabase } from './database'
import { SqliteDocumentRepository } from './document-repository'
import { SqliteFeedbackRepository } from './feedback-repository'

/** Fresh folder for each test's database file. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-feedback-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the repository with one stored suggestion to give feedback on. */
function open() {
  const db = openDatabase(join(dir, 'stylistic.db'))
  new SqliteDocumentRepository(db).resolve({ documentKey: 'doc' })
  const analyses = new SqliteAnalysisRepository(db)
  analyses.create({ id: 'a1', documentId: 'doc', chunks: [{ id: '0', parts: 1 }] })
  analyses.completePart(
    'a1',
    '0',
    0,
    [
      {
        context: 'a b c',
        anchor: 'b',
        justification: 'j',
        category: 'estilo',
        severity: 'low',
        type: 'comment-only'
      }
    ],
    0
  )
  const suggestionId = analyses.get('a1')?.chunks[0]?.suggestions[0]?.id ?? ''
  return { db, suggestionId, feedback: new SqliteFeedbackRepository(db) }
}

describe('SqliteFeedbackRepository', () => {
  it('records feedback as pending, with its comment', () => {
    const { db, suggestionId, feedback } = open()

    const created = feedback.create({
      id: 'f1',
      suggestionId,
      action: 'reject',
      comment: 'Es voseo a propósito'
    })

    expect(created).toMatchObject({
      id: 'f1',
      suggestionId,
      action: 'reject',
      comment: 'Es voseo a propósito',
      status: 'pending'
    })
    expect(created.createdAt).toMatch(/^\d{4}-/)
    expect(feedback.get('f1')).toEqual(created)
    db.close()
  })

  it('completes feedback with its outcome and summary', () => {
    const { db, suggestionId, feedback } = open()
    feedback.create({ id: 'f1', suggestionId, action: 'accept' })

    feedback.complete('f1', 'updated', 'El autor prefiere la raya.')

    expect(feedback.get('f1')).toMatchObject({
      status: 'completed',
      outcome: 'updated',
      summary: 'El autor prefiere la raya.'
    })
    expect(feedback.get('f1')).not.toHaveProperty('comment')
    db.close()
  })

  it('fails feedback with the reason', () => {
    const { db, suggestionId, feedback } = open()
    feedback.create({ id: 'f1', suggestionId, action: 'accept' })

    feedback.fail('f1', 'The model request failed: 400')

    expect(feedback.get('f1')).toMatchObject({ status: 'failed', error: 'The model request failed: 400' })
    db.close()
  })

  it('has nothing for unknown feedback', () => {
    const { db, feedback } = open()

    expect(feedback.get('missing')).toBeUndefined()
    db.close()
  })
})
