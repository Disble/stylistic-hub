import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkflowSuggestion } from '../../analysis/schemas'
import { SqliteAnalysisRepository } from './analysis-repository'
import { openDatabase } from './database'
import { SqliteDocumentRepository } from './document-repository'

/** Fresh folder for each test's database file. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-analyses-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A document key as the add-in sends it. */
const DOC = '6f0c1a52-3d8e-4b6f-9a51-2c7d8e9f0a1b'

/** A replacement suggestion. */
const FIX: WorkflowSuggestion = {
  context: 'ni persona mayores que',
  anchor: 'persona mayores',
  justification: 'Concordancia de número.',
  category: 'gramatica',
  severity: 'high',
  type: 'track-change',
  suggestedText: 'personas mayores'
}

/** An editorial note. */
const NOTE: WorkflowSuggestion = {
  context: 'Hasta que un día fue atrapada.',
  anchor: 'fue atrapada',
  justification: 'Considera la voz activa.',
  category: 'estilo',
  severity: 'low',
  type: 'comment-only'
}

/** Opens the repository on this test's database, with the document already known. */
function open() {
  const db = openDatabase(join(dir, 'stylistic.db'))
  new SqliteDocumentRepository(db).resolve({ documentKey: DOC })
  return { db, analyses: new SqliteAnalysisRepository(db) }
}

describe('SqliteAnalysisRepository', () => {
  it('creates an analysis with its chunks queued and its profile pending', () => {
    const { db, analyses } = open()

    const created = analyses.create({
      id: 'a1',
      documentId: DOC,
      chunks: [
        { id: '0', parts: 1 },
        { id: '1', parts: 2 }
      ]
    })

    expect(created).toMatchObject({
      id: 'a1',
      documentId: DOC,
      status: 'running',
      profile: 'pending',
      chunks: [
        { id: '0', status: 'queued', suggestions: [], dropped: 0 },
        { id: '1', status: 'queued', suggestions: [], dropped: 0 }
      ]
    })
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(analyses.get('a1')).toEqual(created)
    db.close()
  })

  it('has nothing for an unknown analysis', () => {
    const { db, analyses } = open()

    expect(analyses.get('missing')).toBeUndefined()
    db.close()
  })

  it('completes a chunk with its last part, keeping the parts in document order', () => {
    const { db, analyses } = open()
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 2 }] })

    expect(analyses.startChunk('a1', '0')).toBe(true)
    analyses.completePart('a1', '0', 1, [NOTE], 1)
    expect(analyses.get('a1')?.chunks[0]?.status).toBe('running')
    analyses.completePart('a1', '0', 0, [FIX], 0)

    const chunk = analyses.get('a1')?.chunks[0]
    expect(chunk?.status).toBe('completed')
    expect(chunk?.dropped).toBe(1)
    expect(chunk?.suggestions).toEqual(
      [FIX, NOTE].map((s) => ({ ...s, id: expect.stringMatching(/^[0-9a-f]{16}$/) }))
    )
    db.close()
  })

  it('gives every suggestion a short, tag-safe id that is unique across analyses', () => {
    const { db, analyses } = open()
    const ids: string[] = []
    for (const id of ['a1', 'a2']) {
      analyses.create({ id, documentId: DOC, chunks: [{ id: '0', parts: 1 }] })
      analyses.completePart(id, '0', 0, [FIX, NOTE], 0)
      ids.push(...(analyses.get(id)?.chunks[0]?.suggestions.map((s) => s.id) ?? []))
    }

    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/)
    db.close()
  })

  it('finds a stored suggestion and its document by id, for feedback', () => {
    const { db, analyses } = open()
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })
    analyses.completePart('a1', '0', 0, [FIX], 0)
    const id = analyses.get('a1')?.chunks[0]?.suggestions[0]?.id ?? ''

    expect(analyses.suggestion(id)).toEqual({ suggestion: { ...FIX, id }, documentId: DOC })
    expect(analyses.suggestion('0000000000000000')).toBeUndefined()
    db.close()
  })

  it.each([
    ['completed', ['done', 'done']],
    ['partial', ['done', 'failed']],
    ['failed', ['failed', 'failed']]
  ] as const)('settles as %s from its chunks', (status, outcomes) => {
    const { db, analyses } = open()
    analyses.create({
      id: 'a1',
      documentId: DOC,
      chunks: [
        { id: '0', parts: 1 },
        { id: '1', parts: 1 }
      ]
    })
    outcomes.forEach((outcome, i) => {
      if (outcome === 'done') analyses.completePart('a1', String(i), 0, [], 0)
      else analyses.failChunk('a1', String(i), 'The model request failed: 400')
    })

    const finished = analyses.finish('a1')

    expect(finished.status).toBe(status)
    expect(finished.finishedAt).toMatch(/^\d{4}-/)
    if (status !== 'completed') expect(finished.chunks[1]?.error).toBe('The model request failed: 400')
    db.close()
  })

  it('cancels the analysis and its unfinished chunks, and then ignores late writes', () => {
    const { db, analyses } = open()
    analyses.create({
      id: 'a1',
      documentId: DOC,
      chunks: [
        { id: '0', parts: 1 },
        { id: '1', parts: 1 }
      ]
    })
    analyses.completePart('a1', '0', 0, [FIX], 0)

    expect(analyses.cancel('a1')).toBe(true)
    expect(analyses.startChunk('a1', '1')).toBe(false)
    analyses.completePart('a1', '1', 0, [NOTE], 0)
    analyses.setProfile('a1', 'updated')
    analyses.finish('a1')

    const canceled = analyses.get('a1')
    expect(canceled?.status).toBe('canceled')
    expect(canceled?.profile).toBe('pending')
    expect(canceled?.chunks.map((c) => [c.status, c.suggestions.length])).toEqual([
      ['completed', 1],
      ['canceled', 0]
    ])
    expect(analyses.cancel('a1')).toBe(false)
    db.close()
  })

  it('records the profile outcome and the run id', () => {
    const { db, analyses } = open()
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })

    analyses.setRunId('a1', 'run-1')
    analyses.setProfile('a1', 'unchanged')

    expect(analyses.runId('a1')).toBe('run-1')
    expect(analyses.get('a1')?.profile).toBe('unchanged')
    db.close()
  })

  it('fails an analysis whose run stopped, with the reason on its unfinished chunks', () => {
    const { db, analyses } = open()
    analyses.create({
      id: 'a1',
      documentId: DOC,
      chunks: [
        { id: '0', parts: 1 },
        { id: '1', parts: 1 }
      ]
    })
    analyses.completePart('a1', '0', 0, [], 0)

    analyses.fail('a1', 'The hub stopped during the analysis')

    const failed = analyses.get('a1')
    expect(failed?.status).toBe('failed')
    expect(failed?.chunks.map((c) => [c.status, c.error])).toEqual([
      ['completed', undefined],
      ['failed', 'The hub stopped during the analysis']
    ])
    db.close()
  })
})
