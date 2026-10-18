// Channels, staged rollout and pulled versions (odd/tasks/channels.md S1, S3, S4, ADR D4, D9): which catalog
// entries this install is offered, for the engine's installs and the hub's self-update alike.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { componentSchema } from '../../shared/signing/documents'
import type { UpdateEngine } from './engine'
import { HUB_ID, type CatalogEntry } from './install'
import { channelSchema, type Channel, type UpdateState } from './state'

/** The channel component `id` follows: the hub's own entry for the hub, else the component's; `stable` by default. */
export function channelOf(state: UpdateState, id: string): Channel {
  return (id === HUB_ID ? state.hub?.channel : state.components[id]?.channel) ?? 'stable'
}

/**
 * Whether `installId` is in `entry`'s rollout: always at 100%, else when the first 4 bytes of
 * sha256(installId:id:version), read as a big-endian unsigned integer, modulo 100 are below `rolloutPercent`.
 */
export function inRollout(installId: string, entry: CatalogEntry): boolean {
  if (entry.rolloutPercent === 100) return true
  const digest = createHash('sha256').update(`${installId}:${entry.id}:${entry.version}`).digest()
  return digest.readUInt32BE(0) % 100 < entry.rolloutPercent
}

/** Whether `entry` is offered to an install `installId` following `channel`: same channel, not pulled, rolled out. */
export function offered(entry: CatalogEntry, channel: Channel, installId: string): boolean {
  return entry.channel === channel && !entry.blocked.includes(entry.version) && inRollout(installId, entry)
}

/** The two channels the Server screen chooses. */
const targetSchema = z.enum(['server', 'hub'])

/**
 * The channel choices of the Server screen (server and hub) and the Library screen (also installed modules): read
 * the first two, set one and then run a catalog check (S5).
 */
export function channelControls(engine: Pick<UpdateEngine, 'readState' | 'setChannel'>, check: () => void) {
  /** The component `target` names: `hub`, `server`, or a module in the state (else setting it would request it). */
  const componentOf = async (target: string): Promise<string> => {
    const known = targetSchema.safeParse(target)
    if (known.success) return known.data === 'hub' ? HUB_ID : 'server'
    const id = componentSchema.shape.id.parse(target)
    if (!(await engine.readState()).components[id]) throw new Error(`${id} is not installed`)
    return id
  }
  return {
    async get(): Promise<Record<z.infer<typeof targetSchema>, Channel>> {
      const state = await engine.readState()
      return { server: channelOf(state, 'server'), hub: channelOf(state, HUB_ID) }
    },
    /** Validates both values (they come from the renderer) before anything is written; the check runs on its own. */
    async set(target: string, channel: string): Promise<void> {
      const value = channelSchema.parse(channel)
      await engine.setChannel(await componentOf(target), value)
      check()
    }
  }
}
