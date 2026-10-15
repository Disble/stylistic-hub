import type { ZodType } from 'zod'

/** One request whose answer must match `schema`. */
export interface StructuredCallInput<T> {
  system: string
  prompt: string
  schema: ZodType<T>
  temperature?: number
  signal?: AbortSignal
}

/** The language model as the workflows use it: a prompt in, a validated object out. */
export interface LlmPort {
  structuredCall<T>(input: StructuredCallInput<T>): Promise<T>
}
