import { randomUUID } from 'node:crypto'
import type { AnalysisRepository } from '../ports/analysis-repository'
import type { DocumentRepository } from '../ports/document-repository'
import type { WorkflowEngine } from '../ports/workflow-engine'
import type { DocumentGenre } from '../profile/document-context'
import type { Analysis } from './analysis'
import { ANALYSIS_WORKFLOW, type AnalysisInput } from './analysis-workflow'
import { messageOf, Problem } from './errors'
import { splitIntoParts } from './parts'

/** The model corrections run on, as the Provider screen chose it. */
export interface ChosenModel {
  provider: string
  id: string
  name: string
}

/** Whether the hub can analyze now, and why not when it cannot. */
export type Readiness = { ready: true; model: ChosenModel } | { ready: false; reason: string }

/** Why the hub cannot analyze without a model, and where to fix it. */
const NO_MODEL = 'Choose an AI provider and a model in the Stylistic Hub first.'

/** What the analysis service needs. */
export interface AnalysisServiceDeps {
  documents: DocumentRepository
  analyses: AnalysisRepository
  engine: WorkflowEngine
  /** The chosen model, or nothing when none is chosen. */
  model(): Promise<ChosenModel | undefined>
}

/** A request to analyze a document, as the add-in sends it. */
export interface AnalysisRequest {
  genre: DocumentGenre
  chunks: { id: string; text: string }[]
}

/** Starts, reads and cancels analyses; the API's only way in to them. */
export function createAnalysisService({ documents, analyses, engine, model }: AnalysisServiceDeps) {
  /** Whether a model is chosen, which every correction needs. */
  async function readiness(): Promise<Readiness> {
    const chosen = await model()
    return chosen ? { ready: true, model: chosen } : { ready: false, reason: NO_MODEL }
  }

  /**
   * Fails an analysis whose run stopped without settling it, so it never stays running. One with no
   * run yet is still being started.
   */
  async function reconcile(analysis: Analysis): Promise<Analysis> {
    if (analysis.status !== 'running') return analysis
    const runId = analyses.runId(analysis.id)
    if (!runId) return analysis
    const run = await engine.get(runId)
    if (run && run.status !== 'failed' && run.status !== 'canceled') return analysis
    analyses.fail(analysis.id, run?.error ?? 'The analysis stopped before it finished.')
    return analyses.get(analysis.id) as Analysis
  }

  return {
    readiness,

    async start(documentId: string, { genre, chunks }: AnalysisRequest): Promise<Analysis> {
      if (!(await readiness()).ready) throw new Problem('no_model', NO_MODEL)
      documents.resolve({ documentKey: documentId, genre })
      const split = chunks.map((chunk) => ({ id: chunk.id, parts: splitIntoParts(chunk.text) }))
      const id = randomUUID()
      const created = analyses.create({
        id,
        documentId,
        chunks: split.map((chunk) => ({ id: chunk.id, parts: chunk.parts.length }))
      })
      const input: AnalysisInput = { analysisId: id, documentId, genre, chunks: split }
      try {
        analyses.setRunId(id, await engine.start(ANALYSIS_WORKFLOW, input))
      } catch (error) {
        analyses.fail(id, messageOf(error))
        throw error
      }
      return created
    },

    async get(id: string): Promise<Analysis> {
      const analysis = analyses.get(id)
      if (!analysis) throw new Problem('not_found', `No analysis ${id}.`)
      return reconcile(analysis)
    },

    async cancel(id: string): Promise<Analysis> {
      const analysis = analyses.get(id)
      if (!analysis) throw new Problem('not_found', `No analysis ${id}.`)
      if (analyses.cancel(id)) {
        // Parts already running finish their model call, but the canceled analysis ignores them.
        const runId = analyses.runId(id)
        if (runId) await engine.cancel(runId)
      }
      return analyses.get(id) as Analysis
    }
  }
}

/** The analysis service as the API sees it. */
export type AnalysisService = ReturnType<typeof createAnalysisService>
