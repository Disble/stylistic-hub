import type { AnalysisRepository } from '../ports/analysis-repository'
import type { DocumentRepository } from '../ports/document-repository'
import type { LlmPort } from '../ports/llm'
import type { WorkflowBody } from '../ports/workflow-engine'
import type { DocumentGenre } from '../profile/document-context'
import type { ProfileUpdater } from '../profile/profile-updater'
import { normalizeWorkflowOutput } from './normalize'
import { placeable } from './parts'
import { buildUpdateProfilePrompt, countProfileCorrectionPatternsWords } from './profile-update'
import { buildPrompt } from './prompts/correct-text.prompt'
import { DOCUMENT_PROFILE_AGENT_INSTRUCTIONS } from './prompts/document-profile-agent.prompt'
import { buildPreferenceGuidedCorrectionPrompt } from './prompts/preference-guided-correction.prompt'
import { STYLISTIC_AGENT_INSTRUCTIONS } from './prompts/stylistic-agent.prompt'
import {
  portableStylisticWorkflowOutputSchema,
  updateDocumentStyleProfileResultSchema,
  type StylisticWorkflowInput,
  type StylisticWorkflowOutput,
  type WorkflowSuggestion
} from './schemas'

/** The workflow that runs one analysis: its parts in parallel, then one profile update. */
export const ANALYSIS_WORKFLOW = 'analysis'
/** The child workflow that corrects one part of one chunk. */
export const PART_WORKFLOW = 'analyze-part'
/** The child workflow that updates the document's profile from a whole analysis. */
export const PROFILE_WORKFLOW = 'update-profile'

/** What the analysis workflow is started with; the chunks are already split into parts. */
export interface AnalysisInput {
  analysisId: string
  documentId: string
  genre: DocumentGenre
  chunks: { id: string; parts: string[] }[]
}

/** What one part's workflow is started with. */
interface PartInput {
  analysisId: string
  documentId: string
  genre: DocumentGenre
  chunkId: string
  part: number
  text: string
}

/** What a part hands back to the analysis for the profile update; null when it did not run. */
type PartOutput = { suggestions: WorkflowSuggestion[]; cleanPatterns: string[] } | null

/** What the profile update learns from: every part's suggestions and clean patterns. */
interface ProfileInput {
  analysisId: string
  documentId: string
  suggestions: WorkflowSuggestion[]
  cleanPatterns: string[]
}

/** What the analysis workflows need. */
export interface AnalysisWorkflowDeps {
  llm: LlmPort
  documents: DocumentRepository
  analyses: AnalysisRepository
  profile: ProfileUpdater
  /** The user's standing correction instructions, when there are any. */
  correctionInstructions(): Promise<string | undefined>
}

/**
 * Corrects one part with stylistics-backend's prompts and steps: an optional pass guided by the
 * user's preferences, then the integrated correction. It reads the profile but never writes it;
 * the analysis updates the profile once, from every part.
 */
export function analyzePartWorkflow({
  llm,
  documents,
  analyses,
  correctionInstructions
}: AnalysisWorkflowDeps): WorkflowBody {
  /** One correction call of the stylistic agent: deterministic, normalized output. */
  const correct = async (prompt: string): Promise<StylisticWorkflowOutput> =>
    normalizeWorkflowOutput(
      await llm.structuredCall({
        system: STYLISTIC_AGENT_INSTRUCTIONS,
        prompt,
        schema: portableStylisticWorkflowOutputSchema,
        temperature: 0
      })
    )

  return async (raw, step): Promise<PartOutput> => {
    const input = raw as PartInput
    const started = await step.run('start', async () => analyses.startChunk(input.analysisId, input.chunkId))
    if (!started) return null

    const profile = await step.run(
      'load-profile',
      async () => documents.resolve({ documentKey: input.documentId }).profileMarkdown
    )
    const request: StylisticWorkflowInput = {
      text: input.text,
      documentUuid: input.documentId,
      genero: input.genre
    }

    const previousCorrection = await step.run('preference-guided-correction', async () => {
      const instructions = await correctionInstructions()
      if (!instructions) return null
      return correct(buildPreferenceGuidedCorrectionPrompt(request, profile, instructions))
    })

    const output = await step.run('correct-text', () =>
      correct(buildPrompt(request, profile, previousCorrection))
    )

    return step.run('save', async () => {
      const { suggestions, dropped } = placeable(output.suggestions)
      analyses.completePart(input.analysisId, input.chunkId, input.part, suggestions, dropped)
      return { suggestions, cleanPatterns: output.cleanPatterns }
    })
  }
}

/**
 * Updates the document's profile once from a whole analysis, under the document's profile lock so
 * that no other analysis or feedback writes in between; a canceled analysis learns nothing.
 */
export function updateProfileWorkflow({ llm, analyses, profile }: AnalysisWorkflowDeps): WorkflowBody {
  return async (raw, step) => {
    const { analysisId, documentId, suggestions, cleanPatterns } = raw as ProfileInput
    await step.run('update-profile', async () => {
      if (analyses.get(analysisId)?.status !== 'running') return
      if (suggestions.length === 0 && cleanPatterns.length === 0) {
        analyses.setProfile(analysisId, 'unchanged')
        return
      }
      const changed = await profile.update(documentId, async (current) => {
        const updated = await llm.structuredCall({
          system: DOCUMENT_PROFILE_AGENT_INSTRUCTIONS,
          prompt: buildUpdateProfilePrompt({
            documentKey: documentId,
            currentProfileMarkdown: current,
            correctionPatternsWordCount: countProfileCorrectionPatternsWords(current),
            suggestions,
            cleanPatterns
          }),
          schema: updateDocumentStyleProfileResultSchema
        })
        return updated.profileMarkdown
      })
      analyses.setProfile(analysisId, changed ? 'updated' : 'unchanged')
    })
  }
}

/**
 * Runs every part of an analysis as a child workflow, in parallel, and records a part that failed
 * for good on its chunk while the others go on. Then it updates the document's profile once from
 * all the parts, as another child, and settles the analysis. When the profile update fails for
 * good, the suggestions stand and only the profile is marked failed.
 */
export function analysisWorkflow({ analyses }: AnalysisWorkflowDeps): WorkflowBody {
  return async (raw, step) => {
    const input = raw as AnalysisInput
    const { analysisId, documentId } = input

    const outputs = await Promise.all(
      input.chunks.flatMap((chunk, c) =>
        chunk.parts.map(async (text, part): Promise<PartOutput> => {
          const name = `chunk-${c}-part-${part}`
          const partInput: PartInput = {
            analysisId,
            documentId,
            genre: input.genre,
            chunkId: chunk.id,
            part,
            text
          }
          const result = await step.child<PartOutput>(PART_WORKFLOW, partInput, name)
          if (result.ok) return result.value
          await step.run(`${name}-failed`, async () => analyses.failChunk(analysisId, chunk.id, result.error))
          return null
        })
      )
    )
    const done = outputs.filter((output) => output !== null)
    const learn: ProfileInput = {
      analysisId,
      documentId,
      suggestions: done.flatMap((output) => output.suggestions),
      cleanPatterns: done.flatMap((output) => output.cleanPatterns)
    }

    const updated = await step.child(PROFILE_WORKFLOW, learn, 'update-profile')
    if (!updated.ok) await step.run('profile-failed', async () => analyses.setProfile(analysisId, 'failed'))

    await step.run('finish', async () => {
      analyses.finish(analysisId)
    })
  }
}
