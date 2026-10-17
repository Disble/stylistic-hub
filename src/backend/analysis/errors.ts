/** The message of whatever a step threw, which for a provider error is the provider's own. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Why a request cannot be served, in the stable codes the API hands the add-in. */
export type ProblemCode = 'not_found' | 'no_model'

/** A request the hub refuses for a reason the client can act on. */
export class Problem extends Error {
  constructor(
    readonly code: ProblemCode,
    message: string
  ) {
    super(message)
    this.name = 'Problem'
  }
}
