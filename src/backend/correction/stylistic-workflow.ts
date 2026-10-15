import type { DocumentRepository } from '../ports/document-repository'
import type { LlmPort } from '../ports/llm'
import type { WorkflowBody } from '../ports/workflow-engine'
import { normalizeWorkflowOutput } from './normalize'
import { buildUpdateProfilePrompt, countProfileCorrectionPatternsWords } from './profile-update'
import { buildPrompt } from './prompts/correct-text.prompt'
import { DOCUMENT_PROFILE_AGENT_INSTRUCTIONS } from './prompts/document-profile-agent.prompt'
import { buildPreferenceGuidedCorrectionPrompt } from './prompts/preference-guided-correction.prompt'
import { STYLISTIC_AGENT_INSTRUCTIONS } from './prompts/stylistic-agent.prompt'
import {
  portableStylisticWorkflowOutputSchema,
  stylisticWorkflowInputSchema,
  updateDocumentStyleProfileResultSchema,
  type StylisticWorkflowOutput
} from './schemas'

/** The id the add-in starts this workflow by. */
export const STYLISTIC_WORKFLOW_ID = 'stylistic-workflow'

/** What the stylistic workflow needs. */
export interface StylisticWorkflowDeps {
  llm: LlmPort
  documents: DocumentRepository
  /** The user's standing correction instructions, when there are any. */
  correctionInstructions(): Promise<string | undefined>
}

/**
 * stylistics-backend's stylistic-workflow with the same steps: load the document's profile, an
 * optional pass guided by the user's preferences, the integrated correction, and the profile
 * update. The prompts and schemas are the original ones.
 */
export function stylisticWorkflow({
  llm,
  documents,
  correctionInstructions
}: StylisticWorkflowDeps): WorkflowBody {
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

  return async (rawInput, step) => {
    const input = stylisticWorkflowInputSchema.parse(rawInput)

    const profile = await step('load-author-profile', async () => {
      const context = documents.resolve({
        documentKey: input.documentUuid,
        genre: input.genero,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.processingConfig === undefined ? {} : { processingConfig: input.processingConfig })
      })
      return {
        markdown: context.profileMarkdown,
        wordCount: countProfileCorrectionPatternsWords(context.profileMarkdown)
      }
    })

    const previousCorrection = await step('preference-guided-correction', async () => {
      const instructions = await correctionInstructions()
      if (!instructions) return null
      return correct(buildPreferenceGuidedCorrectionPrompt(input, profile.markdown, instructions))
    })

    const output = await step('correct-text', () =>
      correct(buildPrompt(input, profile.markdown, previousCorrection))
    )

    await step('update-profile', async () => {
      const updated = await llm.structuredCall({
        system: DOCUMENT_PROFILE_AGENT_INSTRUCTIONS,
        prompt: buildUpdateProfilePrompt({
          documentKey: input.documentUuid,
          currentProfileMarkdown: profile.markdown,
          correctionPatternsWordCount: profile.wordCount,
          suggestions: output.suggestions,
          cleanPatterns: output.cleanPatterns
        }),
        schema: updateDocumentStyleProfileResultSchema
      })
      documents.updateStyleProfile(input.documentUuid, updated.profileMarkdown)
      return updated.changeSummary
    })

    return output
  }
}
