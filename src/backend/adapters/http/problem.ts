import { z } from '@hono/zod-openapi'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** The stable codes a client can branch on; `detail` says the rest in words. */
export type ApiProblemCode =
  'unauthorized' | 'validation_failed' | 'not_found' | 'no_model' | 'payload_too_large' | 'internal_error'

/** RFC 9457 problem details, with the code the add-in reads. */
const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    code: z.enum([
      'unauthorized',
      'validation_failed',
      'not_found',
      'no_model',
      'payload_too_large',
      'internal_error'
    ])
  })
  .openapi('Problem')

/** The title of each code, as RFC 9457 wants one per problem type. */
const TITLE: Record<ApiProblemCode, string> = {
  unauthorized: 'The hub token is missing or wrong',
  validation_failed: 'The request does not match the API',
  not_found: 'Not found',
  no_model: 'No AI model is chosen',
  payload_too_large: 'The request is too large',
  internal_error: 'The hub failed'
}

/** Answers with an `application/problem+json` body. */
export function problem(
  c: Context,
  status: ContentfulStatusCode,
  code: ApiProblemCode,
  detail: string
): Response {
  const body: z.infer<typeof ProblemSchema> = {
    type: `urn:stylistic:problem:${code}`,
    title: TITLE[code],
    status,
    detail,
    code
  }
  return c.body(JSON.stringify(body), status, { 'Content-Type': 'application/problem+json' })
}

/** A problem response for an OpenAPI route definition. */
export function problemResponse(description: string) {
  return { description, content: { 'application/problem+json': { schema: ProblemSchema } } }
}
