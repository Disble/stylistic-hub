// Copied from stylistics-backend@8165af5 (load-author-profile and correct-text schemas). Hub
// changes: no user or database ids, since the document key identifies the document, and no public
// input schema, since API v1 validates its own request.
import { z } from 'zod'
import type { DocumentGenre } from '../profile/document-context'

/** Canonical correction categories shared by the stylistic agent and author profiles. */
const stylisticCorrectionCategorySchema = z.enum([
  'ortografia',
  'gramatica',
  'puntuacion',
  'tipografia',
  'lexico',
  'estilo'
])

/** Fields every suggestion carries. */
const stylisticSuggestionBaseSchema = z
  .object({
    context: z
      .string()
      .describe(
        'Fragmento suficientemente largo para localizar la corrección de forma inequívoca en el documento.'
      ),
    anchor: z
      .string()
      .describe(
        'Parte exacta del texto que se resalta y reemplaza. Puede ser un solo carácter, una palabra, o un párrafo completo.'
      ),
    justification: z.string(),
    category: stylisticCorrectionCategorySchema,
    severity: z.enum(['high', 'medium', 'low'])
  })
  .strict()

/** Portable transport schema shared across providers for one model-emitted suggestion. */
const portableStylisticSuggestionSchema = stylisticSuggestionBaseSchema
  .extend({
    type: z.enum(['track-change', 'comment-only']),
    suggestedText: z
      .string()
      .optional()
      .describe(
        'Representación textual del reemplazo del anchor. Solo es obligatoria para track-change; comment-only debe omitirla.'
      )
  })
  .strict()

/** Validates one replacement-oriented suggestion emitted by the correction agent. */
export const stylisticTrackChangeSuggestionSchema = stylisticSuggestionBaseSchema
  .extend({
    type: z.literal('track-change'),
    suggestedText: z.string().describe('Reemplazo exacto del anchor. Nunca igual al anchor.')
  })
  .strict()

/** Validates one editorial note that should not rewrite the source text. */
export const stylisticCommentOnlySuggestionSchema = stylisticSuggestionBaseSchema
  .extend({ type: z.literal('comment-only') })
  .strict()

/** Accepts either supported internal suggestion shape after deterministic normalization. */
const stylisticSuggestionSchema = z.discriminatedUnion('type', [
  stylisticTrackChangeSuggestionSchema,
  stylisticCommentOnlySuggestionSchema
])

/** Describes the portable structured output requested from the model transport. */
export const portableStylisticWorkflowOutputSchema = z.object({
  suggestions: z
    .array(portableStylisticSuggestionSchema)
    .describe('Corrections to apply. Each item must describe one localized change only.'),
  cleanPatterns: z
    .array(z.string())
    .describe('Profile patterns found in the text with positive evidence of correct usage.')
})

/** Describes the normalized workflow output returned to correction callers. */
export const stylisticWorkflowOutputSchema = z.object({
  suggestions: z
    .array(stylisticSuggestionSchema)
    .describe('Corrections to apply. Each item must describe one localized change only.'),
  cleanPatterns: z
    .array(z.string())
    .describe('Profile patterns found in the text with positive evidence of correct usage.')
})

/** Structured result expected from the document-profile agent. */
export const updateDocumentStyleProfileResultSchema = z.object({
  profileMarkdown: z.string().min(1),
  changeSummary: z.string().min(1)
})

/** What the correction prompts read of the text to correct. */
export interface StylisticWorkflowInput {
  text: string
  documentUuid: string
  genero: DocumentGenre
}
/** The normalized correction result. */
export type StylisticWorkflowOutput = z.infer<typeof stylisticWorkflowOutputSchema>
/** One model-emitted suggestion before normalization. */
export type PortableWorkflowSuggestion = z.infer<typeof portableStylisticSuggestionSchema>
/** One normalized suggestion. */
export type WorkflowSuggestion = z.infer<typeof stylisticSuggestionSchema>
/** Enumerates the workflow-supported genres for prompt composition helpers. */
export type PromptGenre = StylisticWorkflowInput['genero']
