import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Matches a UUID as `randomUUID` writes it. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * This installation's stable id, created on first use. Some Pi sign-ins (ChatGPT) identify the
 * installation with it. Same approach as dhub.
 */
export function installationId(agentDir: string): string {
  const file = join(agentDir, 'installation-id')
  try {
    const stored = readFileSync(file, 'utf8').trim()
    if (UUID.test(stored)) return stored
  } catch {
    // First use: no id yet.
  }
  const id = randomUUID()
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(file, id, { mode: 0o600 })
  return id
}
