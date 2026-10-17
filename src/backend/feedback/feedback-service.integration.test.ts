import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAnalysisRepository } from '../adapters/sqlite/analysis-repository'
import { openDatabase } from '../adapters/sqlite/database'
import { SqliteDocumentRepository } from '../adapters/sqlite/document-repository'
import { SqliteFeedbackRepository } from '../adapters/sqlite/feedback-repository'
import { createFeedbackService } from './feedback-service'
import { FEEDBACK_WORKFLOW } from './feedback-workflow'

/** Fresh folder for each test's database file. */
let dir: string
/** This test's database. */
let db: DatabaseSync

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-feedback-svc-'))
  db = openDatabase(join(dir, 'stylistic.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** The service over real repositories with one stored suggestion, and an engine that records starts. */
function setup() {
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
  const started: [string, unknown][] = []
  const service = createFeedbackService({
    analyses,
    feedback: new SqliteFeedbackRepository(db),
    engine: {
      start: async (workflow, input) => (started.push([workflow, input]), 'run'),
      get: async () => undefined,
      cancel: async () => undefined
    }
  })
  return { service, started, suggestionId }
}

describe('createFeedbackService', () => {
  it('records feedback on a known suggestion and runs the feedback workflow on it', async () => {
    const { service, started, suggestionId } = setup()

    const feedback = await service.submit({ suggestionId, action: 'reject', comment: 'Es voseo.' })

    expect(feedback).toMatchObject({
      suggestionId,
      action: 'reject',
      comment: 'Es voseo.',
      status: 'pending'
    })
    expect(started).toEqual([[FEEDBACK_WORKFLOW, { feedbackId: feedback.id }]])
    expect(service.get(feedback.id)).toEqual(feedback)
  })

  it('keeps no empty comment', async () => {
    const { service, suggestionId } = setup()

    expect(await service.submit({ suggestionId, action: 'accept', comment: '' })).not.toHaveProperty(
      'comment'
    )
  })

  it('refuses feedback on a suggestion it never made', async () => {
    const { service, started } = setup()

    await expect(
      service.submit({ suggestionId: '0000000000000000', action: 'accept' })
    ).rejects.toMatchObject({
      code: 'not_found'
    })
    expect(started).toEqual([])
  })

  it('says when feedback is unknown', () => {
    expect(() => setup().service.get('missing')).toThrow(expect.objectContaining({ code: 'not_found' }))
  })
})
