import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAnalysisRepository } from '../adapters/sqlite/analysis-repository'
import { openDatabase } from '../adapters/sqlite/database'
import { SqliteDocumentRepository } from '../adapters/sqlite/document-repository'
import type { RunState, WorkflowEngine } from '../ports/workflow-engine'
import { createAnalysisService, type ChosenModel } from './analysis-service'
import { ANALYSIS_WORKFLOW, type AnalysisInput } from './analysis-workflow'
import { MAX_PART_CHARS } from './parts'

/** A document key as the add-in generates it. */
const DOC = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'
/** The model chosen on the Provider screen. */
const FLASH: ChosenModel = { provider: 'opencode-go', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }

/** Fresh folder for each test's database file. */
let dir: string
/** This test's database. */
let db: DatabaseSync

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-analysis-svc-'))
  db = openDatabase(join(dir, 'stylistic.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/** The service over real repositories and an engine that records what it is asked to do. */
function setup({
  model = FLASH,
  run = { status: 'running' }
}: { model?: ChosenModel | null; run?: RunState } = {}) {
  const documents = new SqliteDocumentRepository(db)
  const analyses = new SqliteAnalysisRepository(db)
  const started: { workflow: string; input: AnalysisInput }[] = []
  const canceled: string[] = []
  const engine: WorkflowEngine = {
    start: async (workflow, input) => (started.push({ workflow, input: input as AnalysisInput }), 'run-1'),
    get: async () => run,
    cancel: async (runId) => void canceled.push(runId)
  }
  const service = createAnalysisService({
    documents,
    analyses,
    engine,
    model: async () => model ?? undefined
  })
  return { service, started, canceled, documents, analyses }
}

describe('createAnalysisService', () => {
  it('starts an analysis: stores the genre, records the chunks and runs the analysis workflow', async () => {
    const { service, started, documents, analyses } = setup()

    const analysis = await service.start(DOC, {
      genre: 'narrativa-literaria',
      chunks: [{ id: '0', text: 'Ayer fuistes al mercado.' }]
    })

    expect(analysis).toMatchObject({
      documentId: DOC,
      status: 'running',
      chunks: [{ id: '0', status: 'queued' }]
    })
    expect(documents.get(DOC)?.genre).toBe('narrativa-literaria')
    expect(started).toEqual([
      {
        workflow: ANALYSIS_WORKFLOW,
        input: {
          analysisId: analysis.id,
          documentId: DOC,
          genre: 'narrativa-literaria',
          chunks: [{ id: '0', parts: ['Ayer fuistes al mercado.'] }]
        }
      }
    ])
    expect(analyses.runId(analysis.id)).toBe('run-1')
  })

  it('splits a long chunk into parts at paragraph ends', async () => {
    const { service, started } = setup()
    const paragraph = `${'x'.repeat(MAX_PART_CHARS - 10)}\n`

    await service.start(DOC, { genre: 'general', chunks: [{ id: '0', text: paragraph + paragraph }] })

    expect(started[0]?.input.chunks[0]?.parts).toEqual([paragraph, paragraph])
  })

  it('refuses to start without a chosen model and says where to choose one', async () => {
    const { service, started } = setup({ model: null })

    await expect(
      service.start(DOC, { genre: 'general', chunks: [{ id: '0', text: 'Texto.' }] })
    ).rejects.toMatchObject({
      code: 'no_model',
      message: 'Choose an AI provider and a model in the Stylistic Hub first.'
    })
    expect(started).toEqual([])
  })

  it('reports whether it can analyze, with the chosen model', async () => {
    expect(await setup().service.readiness()).toEqual({ ready: true, model: FLASH })
    expect(await setup({ model: null }).service.readiness()).toEqual({
      ready: false,
      reason: 'Choose an AI provider and a model in the Stylistic Hub first.'
    })
  })

  it('reads an analysis, and says when there is none', async () => {
    const { service } = setup()
    const { id } = await service.start(DOC, { genre: 'general', chunks: [{ id: '0', text: 'Texto.' }] })

    expect((await service.get(id)).id).toBe(id)
    await expect(service.get('missing')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('fails an analysis whose run stopped without settling it, with the run error', async () => {
    const { service } = setup({ run: { status: 'failed', error: 'Out of memory' } })
    const { id } = await service.start(DOC, { genre: 'general', chunks: [{ id: '0', text: 'Texto.' }] })

    const analysis = await service.get(id)

    expect(analysis.status).toBe('failed')
    expect(analysis.chunks[0]).toMatchObject({ status: 'failed', error: 'Out of memory' })
  })

  it('leaves an analysis that is still being started running', async () => {
    const { service, analyses } = setup({ run: { status: 'failed', error: 'never read' } })
    new SqliteDocumentRepository(db).resolve({ documentKey: DOC })
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })

    expect((await service.get('a1')).status).toBe('running')
  })

  it('fails an analysis whose run the engine no longer has', async () => {
    const { analyses } = setup()
    new SqliteDocumentRepository(db).resolve({ documentKey: DOC })
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })
    analyses.setRunId('a1', 'lost')
    const lost = createAnalysisService({
      documents: new SqliteDocumentRepository(db),
      analyses,
      engine: { start: async () => 'run', get: async () => undefined, cancel: async () => undefined },
      model: async () => FLASH
    })

    expect((await lost.get('a1')).chunks[0]).toMatchObject({
      status: 'failed',
      error: 'The analysis stopped before it finished.'
    })
  })

  it('cancels an analysis that has no run yet without asking the engine', async () => {
    const { service, analyses, canceled } = setup()
    new SqliteDocumentRepository(db).resolve({ documentKey: DOC })
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })

    expect((await service.cancel('a1')).status).toBe('canceled')
    expect(canceled).toEqual([])
  })

  it('cancels an analysis and its run, once', async () => {
    const { service, canceled } = setup()
    const { id } = await service.start(DOC, { genre: 'general', chunks: [{ id: '0', text: 'Texto.' }] })

    expect((await service.cancel(id)).status).toBe('canceled')
    expect((await service.cancel(id)).status).toBe('canceled')
    expect(canceled).toEqual(['run-1'])
    await expect(service.cancel('missing')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('fails the analysis when the engine cannot start it', async () => {
    const { analyses } = setup()
    const failing = createAnalysisService({
      documents: new SqliteDocumentRepository(db),
      analyses,
      engine: {
        start: async () => Promise.reject(new Error('database is locked')),
        get: async () => undefined,
        cancel: async () => undefined
      },
      model: async () => FLASH
    })

    await expect(
      failing.start(DOC, { genre: 'general', chunks: [{ id: '0', text: 'Texto.' }] })
    ).rejects.toThrow('database is locked')
    const stored = db.prepare('SELECT status FROM analysis').get() as { status: string }
    expect(stored.status).toBe('failed')
  })
})
