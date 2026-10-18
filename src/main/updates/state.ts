// The update engine's state file, `<userData>/components/state.json` (odd/tasks/update-engine.md S2):
// last seen catalog serial and key list version, the installed versions per component, and the history.
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'

/** How many history entries `state.json` keeps; older ones are dropped first. */
export const HISTORY_LIMIT = 200

/** What happened to a component: installed, failed to install, disabled by revocation, marked bad, switched. */
const outcomeSchema = z.enum(['installed', 'failed', 'disabled', 'marked_bad', 'switched'])

/** One line of the append-only update history. */
const historyEntrySchema = z.object({
  time: z.string(),
  component: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  outcome: outcomeSchema,
  reason: z.string().nullable()
})

/** The release stream a component follows (odd/tasks/channels.md S1); absent means `stable`. */
export const channelSchema = z.enum(['stable', 'beta'])

/** One component's installed versions: `current` runs, `previous` is the rollback target, `bad` never retried. */
const componentStateSchema = z.object({
  current: z.string().nullable(),
  previous: z.string().nullable(),
  bad: z.array(z.string()),
  /** The key that signed `current`'s component.json. */
  keyId: z.string().nullable(),
  channel: channelSchema.optional()
})

/** The whole `state.json`. */
const stateSchema = z.object({
  serial: z.number(),
  keysVersion: z.number(),
  components: z.record(z.string(), componentStateSchema),
  history: z.array(historyEntrySchema),
  /** A random UUID created once, for staged rollouts (odd/tasks/channels.md S3). */
  installId: z.string().optional(),
  /** The hub's own channel; the hub is not a component of `components`. */
  hub: z.object({ channel: channelSchema }).optional()
})

/** A parsed `state.json`. */
export type UpdateState = z.infer<typeof stateSchema>
/** One component's entry in `state.json`. */
export type ComponentState = z.infer<typeof componentStateSchema>
/** A release stream. */
export type Channel = z.infer<typeof channelSchema>
/** One history line. */
export type HistoryEntry = z.infer<typeof historyEntrySchema>

/** The state file's path under the components directory. */
function stateFile(root: string): string {
  return join(root, 'state.json')
}

/** Reads `state.json`; a hub that never checked starts from serial 0 and key list version 0 (trust on first use). */
export async function readState(root: string): Promise<UpdateState> {
  const file = stateFile(root)
  if (!existsSync(file)) return { serial: 0, keysVersion: 0, components: {}, history: [] }
  return stateSchema.parse(JSON.parse(await readFile(file, 'utf8')))
}

/**
 * Writes `data` to `file` through a temporary file in the same directory and a rename, so it is never partial.
 * The temporary name is unique per write, so two writers never write into the same temporary file.
 */
export async function writeAtomic(file: string, data: string): Promise<void> {
  const temp = `${file}.${process.pid}-${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, data)
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}

/** The tail of each root's chain of pending `updateState` calls. */
const pending = new Map<string, Promise<unknown>>()

/**
 * Reads the state, lets `change` edit it, and writes it back atomically. Calls on the same root run one after
 * another (the update check and a rollback can edit it at the same time), so no edit is lost.
 */
export function updateState(root: string, change: (state: UpdateState) => void): Promise<UpdateState> {
  const run = async (): Promise<UpdateState> => {
    const state = await readState(root)
    change(state)
    await mkdir(root, { recursive: true })
    await writeAtomic(stateFile(root), `${JSON.stringify(state, null, 2)}\n`)
    return state
  }
  const next = (pending.get(root) ?? Promise.resolve()).then(run)
  pending.set(
    root,
    next.catch(() => undefined)
  )
  return next
}

/** A component's entry, created empty when the component was never installed. */
export function componentState(state: UpdateState, id: string): ComponentState {
  const entry = state.components[id] ?? { current: null, previous: null, bad: [], keyId: null }
  state.components[id] = entry
  return entry
}

/** Appends a history line, keeping the newest `HISTORY_LIMIT`. */
export function addHistory(state: UpdateState, entry: HistoryEntry): void {
  state.history = [...state.history, entry].slice(-HISTORY_LIMIT)
}
