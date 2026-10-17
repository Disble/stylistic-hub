import type { Analysis, ProfileStatus, Suggestion } from '../analysis/analysis'
import type { WorkflowSuggestion } from '../analysis/schemas'

/** A new analysis: its chunks in the add-in's order, each with the number of parts the hub runs. */
export interface NewAnalysis {
  id: string
  documentId: string
  chunks: { id: string; parts: number }[]
}

/** A stored suggestion together with the document it was made for, as feedback needs it. */
export interface StoredSuggestion {
  suggestion: Suggestion
  documentId: string
}

/**
 * The hub's record of each analysis, written by the workflow steps and read by the API. Once an
 * analysis is canceled or finished, writes to it are ignored, so a step that ends late changes
 * nothing.
 */
export interface AnalysisRepository {
  create(analysis: NewAnalysis): Analysis
  get(id: string): Analysis | undefined
  setRunId(id: string, runId: string): void
  runId(id: string): string | undefined
  /** Marks a chunk running; false when the analysis was canceled and the part must not run. */
  startChunk(id: string, chunkId: string): boolean
  /** Records one part's suggestions under new ids; the chunk completes with its last part. */
  completePart(
    id: string,
    chunkId: string,
    part: number,
    suggestions: WorkflowSuggestion[],
    dropped: number
  ): void
  failChunk(id: string, chunkId: string, error: string): void
  setProfile(id: string, status: ProfileStatus): void
  /** Settles the analysis from its chunks: completed, partial or failed. */
  finish(id: string): Analysis
  /** Cancels the analysis and its unfinished chunks; false when it had already finished. */
  cancel(id: string): boolean
  /** Fails an analysis whose run stopped without settling it, as after a crash. */
  fail(id: string, error: string): void
  suggestion(id: string): StoredSuggestion | undefined
}
