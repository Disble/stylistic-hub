import type { Feedback, FeedbackOutcome } from '../feedback/feedback'

/** A new piece of feedback, before its workflow runs. */
export interface NewFeedback {
  id: string
  suggestionId: string
  action: Feedback['action']
  comment?: string
}

/** The hub's record of each piece of feedback, written by its workflow and read by the API. */
export interface FeedbackRepository {
  create(feedback: NewFeedback): Feedback
  get(id: string): Feedback | undefined
  complete(id: string, outcome: FeedbackOutcome, summary?: string): void
  fail(id: string, error: string): void
}
