import type { DatabaseSync } from 'node:sqlite'
import { normalizeCorrectionInstructions } from '../../profile/preferences'
import type { PreferencesRepository } from '../../ports/preferences-repository'

/** The user's preferences in the single row of the `preferences` table. */
export class SqlitePreferencesRepository implements PreferencesRepository {
  constructor(private readonly db: DatabaseSync) {}

  getCorrectionInstructions(): string | null {
    const row = this.db.prepare('SELECT correction_instructions FROM preferences WHERE id = 1').get() as
      { correction_instructions: string | null } | undefined
    return row?.correction_instructions ?? null
  }

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
