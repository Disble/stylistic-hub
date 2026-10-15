/** Where the user's correction preferences are kept. One hub serves one Windows user. */
export interface PreferencesRepository {
  getCorrectionInstructions(): string | null
  /** Saves the instructions, or clears them with null or blank text, and returns what was stored. */
  setCorrectionInstructions(value: string | null): string | null
}
