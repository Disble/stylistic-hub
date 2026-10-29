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

/**
 * Whether `entry` is offered to an install `installId` following `channel`: on that channel (`beta` also takes
 * `stable` entries, so it is never behind stable: odd/tasks/catalog-auto-update.md S1), not pulled, rolled out.
 */
export function offered(entry: CatalogEntry, channel: Channel, installId: string): boolean {
  const onChannel = entry.channel === channel || channel === 'beta'
  return onChannel && !entry.blocked.includes(entry.version) && inRollout(installId, entry)
}

/** A release version: semver with an optional `-beta.N` (the signing schemas' pattern). */
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/

/** Major, minor, patch and beta number; a release sorts after all its betas. */
function versionKey(version: string): number[] | undefined {
  const match = VERSION.exec(version)
  return match ? [1, 2, 3, 4].map((group) => Number(match[group] ?? Number.MAX_SAFE_INTEGER)) : undefined
}

/**
 * Whether `candidate` is a newer version than `current`; false when either is not a release version. Ours,
 * because `semver` is not a dependency and the versions are held to the four-number pattern above.
 */
export function isNewer(candidate: string, current: string): boolean {
  const [next, now] = [versionKey(candidate), versionKey(current)]
  if (!next || !now) return false
  return (next.map((part, position) => part - Number(now[position])).find((diff) => diff !== 0) ?? 0) > 0
}

/**
 * The newest of `entries` offered to `installId` on `channel`, whatever their catalog order (S2): what the
 * engine installs, the self-update serves and the Library shows. The caller narrows `entries` to one component.
 */
export function newestOffered(
  entries: readonly CatalogEntry[],
  channel: Channel,
  installId: string
): CatalogEntry | undefined {
  return entries
    .filter((entry) => offered(entry, channel, installId))
    .reduce<CatalogEntry | undefined>(
      (newest, entry) => (!newest || isNewer(entry.version, newest.version) ? entry : newest),
      undefined
    )
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
