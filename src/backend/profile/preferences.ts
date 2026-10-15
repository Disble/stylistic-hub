/** Longest correction instructions a user may save; the same limit as stylistics-backend. */
export const CORRECTION_INSTRUCTIONS_MAX_LENGTH = 4000

/** Instructions as stored: trimmed, and blank text means none. */
export function normalizeCorrectionInstructions(value: string | null): string | null {
  return value?.trim() || null
}
