import type { AnalysisRepository } from '../ports/analysis-repository'
import type { FeedbackRepository } from '../ports/feedback-repository'
import type { LlmPort } from '../ports/llm'
import type { WorkflowBody } from '../ports/workflow-engine'
import type { ProfileUpdater } from '../profile/profile-updater'
import { DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS } from './prompts/document-feedback-agent.prompt'
import { buildProcessFeedbackPrompt } from './prompts/process-feedback.prompt'
import { processFeedbackResultSchema } from './schemas'

/** The workflow that learns from one piece of feedback. */
export const FEEDBACK_WORKFLOW = 'feedback'
/** Its child, which does the work and may fail for good after its retries. */
export const PROCESS_FEEDBACK_WORKFLOW = 'process-feedback'

/** What both feedback workflows are started with. */
interface FeedbackInput {
  feedbackId: string
}

/** What the feedback workflow needs. */
export interface FeedbackWorkflowDeps {
  llm: LlmPort
  analyses: AnalysisRepository
  feedback: FeedbackRepository
  profile: ProfileUpdater
}

/** Runs the feedback's processing as a child and records the feedback failed when it fails for good. */
export function feedbackWorkflow({ feedback }: FeedbackWorkflowDeps): WorkflowBody {
  return async (raw, step) => {
    const { feedbackId } = raw as FeedbackInput
    const result = await step.child(PROCESS_FEEDBACK_WORKFLOW, { feedbackId }, 'process-feedback')
    if (!result.ok) await step.run('failed', async () => feedback.fail(feedbackId, result.error))
  }
}

/**
 * stylistics-backend's feedback step over the stored suggestion: feedback without a comment is
 * only acknowledged; with one, the feedback agent decides whether it changes the document's
 * profile, reading the profile current under the document's profile lock. The prompts and schemas
 * are the original ones.
 */
export function processFeedbackWorkflow({
  llm,
  analyses,
  feedback,
  profile
}: FeedbackWorkflowDeps): WorkflowBody {
  return async (raw, step) => {
    const { feedbackId } = raw as FeedbackInput
    await step.run('process-feedback', async () => {
      const item = feedback.get(feedbackId)
      const stored = item && analyses.suggestion(item.suggestionId)
      if (!item || !stored) throw new Error(`Feedback ${feedbackId} or its suggestion is gone`)
      if (!item.comment) {
        feedback.complete(feedbackId, 'acknowledged')
        return
      }
      const { suggestion, documentId } = stored
      let summary: string | undefined
      const changed = await profile.update(documentId, async (current) => {
        const result = await llm.structuredCall({
          system: DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS,
          prompt: buildProcessFeedbackPrompt({
            category: suggestion.category,
            context: suggestion.context,
            anchor: suggestion.anchor,
            ...(suggestion.type === 'track-change' ? { suggestedText: suggestion.suggestedText } : {}),
            justification: suggestion.justification,
            action: item.action,
            severity: suggestion.severity,
            suggestionType: suggestion.type,
            comment: item.comment,
            documentUuid: documentId,
            authorProfile: current
          }),
          schema: processFeedbackResultSchema
        })
        summary = result.decisionSummary
        if (result.status !== 'updated') return undefined
        if (!result.profileMarkdown) {
          throw new Error('Document feedback agent returned an updated status without profile markdown.')
        }
        return result.profileMarkdown
      })
      feedback.complete(feedbackId, changed ? 'updated' : 'ignored', summary)
    })
  }
}
