import { randomUUID } from 'node:crypto'
import { messageOf, Problem } from '../analysis/errors'
import type { AnalysisRepository } from '../ports/analysis-repository'
import type { FeedbackRepository } from '../ports/feedback-repository'
import type { WorkflowEngine } from '../ports/workflow-engine'
import type { Feedback } from './feedback'
import { FEEDBACK_WORKFLOW } from './feedback-workflow'

/** What the feedback service needs. */
export interface FeedbackServiceDeps {
  analyses: AnalysisRepository
  feedback: FeedbackRepository
  engine: WorkflowEngine
}

/** The author's verdict on a suggestion, as the add-in sends it. */
export interface FeedbackRequest {
  suggestionId: string
  action: Feedback['action']
  comment?: string | undefined
}

/** Records feedback on a suggestion the hub made and learns from it in the background. */
export function createFeedbackService({ analyses, feedback, engine }: FeedbackServiceDeps) {
  return {
    async submit({ suggestionId, action, comment }: FeedbackRequest): Promise<Feedback> {
      if (!analyses.suggestion(suggestionId)) throw new Problem('not_found', `No suggestion ${suggestionId}.`)
      const id = randomUUID()
      const created = feedback.create({ id, suggestionId, action, ...(comment ? { comment } : {}) })
      try {
        await engine.start(FEEDBACK_WORKFLOW, { feedbackId: id })
      } catch (error) {
        // The add-in sends feedback and forgets it: the failure is answered as the feedback's state.
        feedback.fail(id, messageOf(error))
        return feedback.get(id) as Feedback
      }
      return created
    },

    get(id: string): Feedback {
      const found = feedback.get(id)
      if (!found) throw new Problem('not_found', `No feedback ${id}.`)
      return found
    }
  }
}

/** The feedback service as the API sees it. */
export type FeedbackService = ReturnType<typeof createFeedbackService>
