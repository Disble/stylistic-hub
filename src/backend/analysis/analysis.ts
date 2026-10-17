import type { WorkflowSuggestion } from './schemas'

/** Where a whole analysis is. `partial`: some chunks failed, the others have suggestions. */
export type AnalysisStatus = 'running' | 'completed' | 'partial' | 'failed' | 'canceled'

/** Where one of the add-in's chunks is. */
export type ChunkStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

/** What became of the document's style profile once the chunks were done. */
export type ProfileStatus = 'pending' | 'updated' | 'unchanged' | 'failed'

/** A suggestion as the hub hands it out, under the id the add-in writes into Word. */
export type Suggestion = WorkflowSuggestion & { id: string }

/** One chunk of an analysis. */
export interface ChunkState {
  id: string
  status: ChunkStatus
  suggestions: Suggestion[]
  /** Suggestions the hub discarded because the add-in could not have placed them. */
  dropped: number
  error?: string
}

/** One request to analyze a document, chunk by chunk. */
export interface Analysis {
  id: string
  documentId: string
  status: AnalysisStatus
  chunks: ChunkState[]
  profile: ProfileStatus
  createdAt: string
  finishedAt?: string
}
