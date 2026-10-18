import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { bodyLimit } from 'hono/body-limit'
import type { AnalysisService } from '../../analysis/analysis-service'
import { Problem } from '../../analysis/errors'
import {
  stylisticCommentOnlySuggestionSchema,
  stylisticTrackChangeSuggestionSchema
} from '../../analysis/schemas'
import type { FeedbackService } from '../../feedback/feedback-service'
import type { DocumentRepository } from '../../ports/document-repository'
import { DOCUMENT_GENRES } from '../../profile/document-context'
import { CORRECTION_INSTRUCTIONS_MAX_LENGTH } from '../../profile/preferences'
import type { SqlitePreferencesRepository } from '../sqlite/preferences-repository'
import { problem, problemResponse } from './problem'

/** What the API needs from the composition root. */
export interface ApiV1Options {
  serverVersion: string
  analyses: AnalysisService
  feedback: FeedbackService
  documents: DocumentRepository
  preferences: SqlitePreferencesRepository
}

/** Largest request body: a whole novel is about 1 MB of text. */
const MAX_BODY_BYTES = 10 * 1024 * 1024

/** A document's id: the UUID the add-in keeps in the document's settings. */
const DocumentIdSchema = z.uuid().openapi({ description: 'The id the add-in stores in the Word document.' })

/** The genres a document can be written in. */
const GenreSchema = z.enum(DOCUMENT_GENRES).openapi('Genre')

/** A suggestion under the id the add-in writes into Word: 16 hex characters, unique for good. */
const SuggestionSchema = z
  .discriminatedUnion('type', [
    stylisticTrackChangeSuggestionSchema.extend({ id: z.string() }),
    stylisticCommentOnlySuggestionSchema.extend({ id: z.string() })
  ])
  .openapi('Suggestion')

/** One of the add-in's chunks within an analysis. */
const ChunkSchema = z
  .object({
    id: z.string(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'canceled']),
    suggestions: z.array(SuggestionSchema),
    error: z
      .string()
      .optional()
      .openapi({ description: 'Why the chunk failed, with the provider’s own message.' })
  })
  .openapi('Chunk')

/** An analysis and every chunk's state; poll it until `status` is no longer `running`. */
const AnalysisSchema = z
  .object({
    id: z.uuid(),
    documentId: z.string(),
    status: z.enum(['running', 'completed', 'partial', 'failed', 'canceled']),
    chunks: z.array(ChunkSchema),
    profile: z.enum(['pending', 'updated', 'unchanged', 'failed']),
    createdAt: z.string(),
    finishedAt: z.string().optional()
  })
  .openapi('Analysis')

/** A request to analyze a document. */
const AnalysisRequestSchema = z
  .object({
    genre: GenreSchema,
    chunks: z
      .array(z.object({ id: z.string().min(1).max(64), text: z.string().min(1) }))
      .min(1)
      .max(1000)
      .refine((chunks) => new Set(chunks.map((c) => c.id)).size === chunks.length, 'Chunk ids must be unique')
  })
  .openapi('AnalysisRequest')

/** Feedback as the hub records it. */
const FeedbackSchema = z
  .object({
    id: z.uuid(),
    suggestionId: z.string(),
    action: z.enum(['accept', 'reject']),
    comment: z.string().optional(),
    status: z.enum(['pending', 'completed', 'failed']),
    outcome: z.enum(['updated', 'ignored', 'acknowledged']).optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
    createdAt: z.string()
  })
  .openapi('Feedback')

/** The author's verdict on one suggestion. */
const FeedbackRequestSchema = z
  .object({
    suggestionId: z.string().regex(/^[0-9a-f]{16}$/),
    action: z.enum(['accept', 'reject']),
    comment: z.string().max(4000).optional()
  })
  .openapi('FeedbackRequest')

/** The user's standing correction instructions. */
const PreferencesSchema = z
  .object({
    correctionInstructions: z.string().nullable(),
    correctionInstructionsMaxLength: z.number().int()
  })
  .openapi('Preferences')

/** What the hub can do now. */
const StatusSchema = z
  .object({
    version: z.string(),
    analysis: z.object({
      ready: z.boolean(),
      reason: z.string().optional(),
      model: z.object({ provider: z.string(), id: z.string(), name: z.string() }).optional()
    })
  })
  .openapi('Status')

/** A document and its living style profile. */
const DocumentSchema = z
  .object({
    id: z.string(),
    genre: GenreSchema,
    profile: z.object({ markdown: z.string(), updatedAt: z.string().nullable() })
  })
  .openapi('Document')

/** JSON content of a schema. */
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } }
})

/** Every route requires the hub token. */
const security = [{ Bearer: [] }]

/** The answer of a request the API refused. */
const refused = {
  400: problemResponse('The request does not match the API'),
  401: problemResponse('The hub token is missing or wrong')
}

/** A route on one resource named by a UUID, answering it or a `not_found` problem. */
function resourceRoute<K extends string, T extends z.ZodType>(route: {
  method: 'get' | 'post'
  path: string
  param: K
  summary: string
  schema: T
  description: string
  missing: string
}) {
  return createRoute({
    method: route.method,
    path: route.path,
    security,
    summary: route.summary,
    request: { params: z.object({ [route.param]: z.uuid() } as Record<K, z.ZodUUID>) },
    responses: { 200: json(route.schema, route.description), ...refused, 404: problemResponse(route.missing) }
  })
}

/** The routes of API v1, the contract the add-in's `HubAnalysisAdapter` is written against. */
const routes = {
  status: createRoute({
    method: 'get',
    path: '/status',
    security,
    summary: 'Whether the hub can analyze now',
    responses: { 200: json(StatusSchema, 'The hub’s version and readiness'), 401: refused[401] }
  }),
  document: createRoute({
    method: 'get',
    path: '/documents/{documentId}',
    security,
    summary: 'A document’s genre and style profile',
    request: { params: z.object({ documentId: DocumentIdSchema }) },
    responses: {
      200: json(DocumentSchema, 'The document'),
      ...refused,
      404: problemResponse('No analysis of it yet')
    }
  }),
  startAnalysis: createRoute({
    method: 'post',
    path: '/documents/{documentId}/analyses',
    security,
    summary: 'Analyze a document, chunk by chunk',
    request: {
      params: z.object({ documentId: DocumentIdSchema }),
      body: { required: true, content: { 'application/json': { schema: AnalysisRequestSchema } } }
    },
    responses: {
      202: json(AnalysisSchema, 'The analysis, started'),
      ...refused,
      409: problemResponse('No AI model is chosen in the hub'),
      413: problemResponse('The request is too large')
    }
  }),
  analysis: resourceRoute({
    method: 'get',
    path: '/analyses/{analysisId}',
    param: 'analysisId',
    summary: 'An analysis and its chunks so far',
    schema: AnalysisSchema,
    description: 'The analysis',
    missing: 'No such analysis'
  }),
  cancelAnalysis: resourceRoute({
    method: 'post',
    path: '/analyses/{analysisId}/cancel',
    param: 'analysisId',
    summary: 'Cancel an analysis and every chunk still running',
    schema: AnalysisSchema,
    description: 'The analysis, canceled, or as it finished',
    missing: 'No such analysis'
  }),
  submitFeedback: createRoute({
    method: 'post',
    path: '/feedback',
    security,
    summary: 'Accept or reject a suggestion; the hub learns from it in the background',
    request: { body: { required: true, content: { 'application/json': { schema: FeedbackRequestSchema } } } },
    responses: {
      202: json(FeedbackSchema, 'The feedback, recorded'),
      ...refused,
      404: problemResponse('The hub never made that suggestion')
    }
  }),
  feedback: resourceRoute({
    method: 'get',
    path: '/feedback/{feedbackId}',
    param: 'feedbackId',
    summary: 'What became of a piece of feedback',
    schema: FeedbackSchema,
    description: 'The feedback',
    missing: 'No such feedback'
  }),
  preferences: createRoute({
    method: 'get',
    path: '/preferences',
    security,
    summary: 'The standing correction instructions',
    responses: { 200: json(PreferencesSchema, 'The preferences'), 401: refused[401] }
  }),
  savePreferences: createRoute({
    method: 'put',
    path: '/preferences',
    security,
    summary: 'Save the standing correction instructions; null or blank clears them',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z
              .object({
                correctionInstructions: z.string().max(CORRECTION_INSTRUCTIONS_MAX_LENGTH).nullable()
              })
              .strict()
          }
        }
      }
    },
    responses: { 200: json(PreferencesSchema, 'What was stored'), ...refused }
  })
}

/** The status of each domain problem. */
const PROBLEM_STATUS = { not_found: 404, no_model: 409 } as const

/**
 * API v1 over the analysis and feedback services. Request bodies and parameters are validated by
 * the same zod schemas `GET /openapi.json` publishes; a request that does not match gets a
 * `validation_failed` problem naming what is wrong.
 */
export function apiV1({
  serverVersion,
  analyses,
  feedback,
  documents,
  preferences
}: ApiV1Options): OpenAPIHono {
  const api = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return problem(c, 400, 'validation_failed', z.prettifyError(result.error))
      return undefined
    }
  })

  api.onError((error, c) => {
    if (error instanceof Problem) return problem(c, PROBLEM_STATUS[error.code], error.code, error.message)
    throw error
  })

  api.use(
    '*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => problem(c, 413, 'payload_too_large', `Requests are limited to ${MAX_BODY_BYTES} bytes.`)
    })
  )

  /** Preferences in the API's shape. */
  const answerPreferences = (correctionInstructions: string | null) => ({
    correctionInstructions,
    correctionInstructionsMaxLength: CORRECTION_INSTRUCTIONS_MAX_LENGTH
  })

  api.openapi(routes.status, async (c) =>
    c.json({ version: serverVersion, analysis: await analyses.readiness() }, 200)
  )

  api.openapi(routes.document, (c) => {
    const { documentId } = c.req.valid('param')
    const document = documents.get(documentId)
    if (!document) throw new Problem('not_found', `No document ${documentId}: it has not been analyzed yet.`)
    return c.json(
      {
        id: document.documentKey,
        genre: document.genre,
        profile: { markdown: document.profileMarkdown, updatedAt: document.profileUpdatedAt }
      },
      200
    )
  })

  api.openapi(routes.startAnalysis, async (c) => {
    const analysis = await analyses.start(c.req.valid('param').documentId, c.req.valid('json'))
    return c.json(analysis, 202)
  })

  api.openapi(routes.analysis, async (c) => c.json(await analyses.get(c.req.valid('param').analysisId), 200))

  api.openapi(routes.cancelAnalysis, async (c) =>
    c.json(await analyses.cancel(c.req.valid('param').analysisId), 200)
  )

  api.openapi(routes.submitFeedback, async (c) => c.json(await feedback.submit(c.req.valid('json')), 202))

  api.openapi(routes.feedback, (c) => c.json(feedback.get(c.req.valid('param').feedbackId), 200))

  api.openapi(routes.preferences, (c) =>
    c.json(answerPreferences(preferences.getCorrectionInstructions()), 200)
  )

  api.openapi(routes.savePreferences, (c) =>
    c.json(
      answerPreferences(preferences.setCorrectionInstructions(c.req.valid('json').correctionInstructions)),
      200
    )
  )

  api.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'The hub token from the task pane’s `<meta name="stylistic-hub-token">`.'
  })
  api.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Stylistic Hub API', version: '1' },
    servers: [{ url: '/api/v1' }]
  })

  return api
}
