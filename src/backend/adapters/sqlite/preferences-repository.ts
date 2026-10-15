import type { DatabaseSync } from 'node:sqlite'
import { normalizeCorrectionInstructions } from '../../profile/preferences'

/**
 * The user's preferences in the single row of the `preferences` table. No port: only the HTTP
 * routes and the composition root use it, and their tests run on an in-memory database.
 */
export class SqlitePreferencesRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** The saved instructions, or null when there are none. */
  getCorrectionInstructions(): string | null {
    const row = this.db.prepare('SELECT correction_instructions FROM preferences WHERE id = 1').get() as
      { correction_instructions: string | null } | undefined
    return row?.correction_instructions ?? null
  }

  /** Saves the instructions, or clears them with null or blank text, and returns what was stored. */
  setCorrectionInstructions(value: string | null): string | null {
    const stored = normalizeCorrectionInstructions(value)
    this.db
      .prepare(
        `INSERT INTO preferences (id, correction_instructions) VALUES (1, :value)
         ON CONFLICT (id) DO UPDATE SET correction_instructions = excluded.correction_instructions`
      )
      .run({ value: stored })
    return stored
  }
}
