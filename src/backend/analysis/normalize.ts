// Copied from stylistics-backend@8165af5 (correct-text.helpers.ts, normalization only).
import {
  portableStylisticWorkflowOutputSchema,
  stylisticWorkflowOutputSchema,
  type PortableWorkflowSuggestion,
  type StylisticWorkflowOutput,
  type WorkflowSuggestion
} from './schemas'

/**
 * Normalizes one provider-portable suggestion into the internal discriminated union: a
 * track-change without a replacement, or whose replacement equals its anchor, is a comment.
 */
function normalizeSuggestion(suggestion: PortableWorkflowSuggestion): WorkflowSuggestion {
  const { suggestedText, ...rest } = suggestion
  if (
    suggestion.type === 'comment-only' ||
    typeof suggestedText !== 'string' ||
    suggestedText === suggestion.anchor
  ) {
    return { ...rest, type: 'comment-only' }
  }
  return { ...rest, type: 'track-change', suggestedText }
}

/** Validates and normalizes the model's portable output before the next steps use it. */
export function normalizeWorkflowOutput(output: unknown): StylisticWorkflowOutput {
  const parsed = portableStylisticWorkflowOutputSchema.parse(output)
  return stylisticWorkflowOutputSchema.parse({
    suggestions: parsed.suggestions.map(normalizeSuggestion),
    cleanPatterns: parsed.cleanPatterns
  })
}
