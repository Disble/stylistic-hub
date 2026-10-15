import { Hono } from 'hono'
import { z } from 'zod'
import type { SqlitePreferencesRepository } from '../sqlite/preferences-repository'
import { CORRECTION_INSTRUCTIONS_MAX_LENGTH } from '../../profile/preferences'

/** The request stylistics-backend accepted: the instructions, or null to clear them. */
const updateRequestSchema = z
  .object({ correctionInstructions: z.string().max(CORRECTION_INSTRUCTIONS_MAX_LENGTH).nullable() })
  .strict()

/**
 * `GET`/`PUT /user/preferences` with stylistics-backend's contract, which the add-in's settings
 * view already calls. There is no user: the hub belongs to one Windows user.
 */
export function preferencesRoutes(preferences: SqlitePreferencesRepository): Hono {
  const routes = new Hono()
  /** The response both methods share. */
  const answer = (correctionInstructions: string | null) => ({
    correctionInstructions,
    correctionInstructionsMaxLength: CORRECTION_INSTRUCTIONS_MAX_LENGTH
  })

  routes.get('/', (c) => c.json(answer(preferences.getCorrectionInstructions())))

  routes.put('/', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined)
    if (body === undefined) return c.json({ error: 'invalid_json_body' }, 400)
    const parsed = updateRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid_user_preferences_request', issues: parsed.error.issues }, 400)
    }
    return c.json(answer(preferences.setCorrectionInstructions(parsed.data.correctionInstructions)))
  })

  return routes
}
