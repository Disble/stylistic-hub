import type { WorkflowSuggestion } from './schemas'

/**
 * Characters of text per model call. The add-in sends chunks of up to 100,000 characters, which
 * as one call is slow and the likeliest to time out; about 3,000 tokens of text per call keeps the
 * answer short. The add-in finds suggestions by their text, so parts need not match its chunks.
 */
export const MAX_PART_CHARS = 12_000

/**
 * Splits a chunk into parts at paragraph ends, packing paragraphs up to `max` characters. A
 * paragraph is never cut, so a suggestion's context never spans two parts; one longer than `max`
 * becomes a part of its own. Joining the parts gives back the chunk.
 */
export function splitIntoParts(text: string, max = MAX_PART_CHARS): string[] {
  const paragraphs = text.match(/[^\n]*\n|[^\n]+$/g) ?? [text]
  const parts: string[] = []
  let current = ''
  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length > max) {
      parts.push(current)
      current = ''
    }
    current += paragraph
  }
  parts.push(current)
  return parts
}

/**
 * Keeps the suggestions the add-in can place: it finds a suggestion by its anchor inside its
 * context, so one whose anchor is not there would be lost in Word, and like the add-in it rejects
 * a blank anchor, context or justification. The rest are counted.
 */
export function placeable(suggestions: WorkflowSuggestion[]): {
  suggestions: WorkflowSuggestion[]
  dropped: number
} {
  const kept = suggestions.filter(
    (s) => s.anchor.trim() && s.context.trim() && s.justification.trim() && s.context.includes(s.anchor)
  )
  return { suggestions: kept, dropped: suggestions.length - kept.length }
}
