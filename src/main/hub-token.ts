import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** A token is 32 random bytes, hex-encoded. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/

/**
 * Returns this install's hub token, creating it on first start. The task pane sends it as a
 * bearer token; there are no user accounts (one hub per Windows user).
 */
export function loadOrCreateHubToken(file: string): string {
  try {
    const stored = readFileSync(file, 'utf8').trim()
    if (TOKEN_PATTERN.test(stored)) return stored
  } catch {
    // First start: no token yet.
  }
  const token = randomBytes(32).toString('hex')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, token, { mode: 0o600 })
  return token
}
