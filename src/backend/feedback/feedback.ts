/** Where a piece of feedback is. */
export type FeedbackStatus = 'pending' | 'completed' | 'failed'

/** What the feedback did to the document's profile; `acknowledged`: no comment to learn from. */
export type FeedbackOutcome = 'updated' | 'ignored' | 'acknowledged'

/** The author's verdict on one suggestion. */
export interface Feedback {
  id: string
  suggestionId: string
  action: 'accept' | 'reject'
  comment?: string
  status: FeedbackStatus
  outcome?: FeedbackOutcome
  /** The feedback agent's reason, when it judged a comment. */
  summary?: string
  error?: string
  createdAt: string
}
