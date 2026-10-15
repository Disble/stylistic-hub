import type { DocumentRepository } from '../ports/document-repository'
import type { LlmPort } from '../ports/llm'
import type { WorkflowBody } from '../ports/workflow-engine'
import { DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS } from './prompts/document-feedback-agent.prompt'
import { buildProcessFeedbackPrompt } from './prompts/process-feedback.prompt'
import { feedbackWorkflowInputSchema, processFeedbackResultSchema } from './schemas'

/** The id the add-in starts this workflow by. */
export const FEEDBACK_WORKFLOW_ID = 'feedback-workflow'

/** What the feedback workflow needs. */
export interface FeedbackWorkflowDeps {
  llm: LlmPort
  documents: DocumentRepository
}

/**
 * stylistics-backend's feedback-workflow with the same steps: load the document's profile, then
 * let the feedback agent decide whether the author's comment changes it. Feedback without a
 * comment is only acknowledged. The prompts and schemas are the original ones.
 */
export function feedbackWorkflow({ llm, documents }: FeedbackWorkflowDeps): WorkflowBody {
  return async (rawInput, step) => {
    const input = feedbackWorkflowInputSchema.parse(rawInput)

    const authorProfile = await step(
      'load-author-profile',
      async () => documents.resolve({ documentKey: input.documentUuid }).profileMarkdown
    )

    return step('process-feedback', async () => {
      if (input.comment) {
        const result = await llm.structuredCall({
          system: DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS,
          prompt: buildProcessFeedbackPrompt({ ...input, authorProfile }),
          schema: processFeedbackResultSchema
        })
        if (result.status === 'updated') {
          if (!result.profileMarkdown) {
            throw new Error('Document feedback agent returned an updated status without profile markdown.')
          }
          documents.updateStyleProfile(input.documentUuid, result.profileMarkdown)
        }
      }
      return { received: true, receivedAt: new Date().toISOString() }
    })
  }
}
