// The hub's self-update (odd/tasks/update-engine.md S4, ADR D10): after each verified catalog check, the
// `stylistic-hub` entry offered on the hub's channel (odd/tasks/channels.md S1-S4) and newer than the running hub,
// or older after a channel switch, is downloaded and verified by the engine, served from the
// loopback feed, and only then handed to electron-updater, which re-checks its sha512 and installs it on quit.
import { channelOf, offered } from './channels'
import type { CheckReport, UpdateEngine } from './engine'
import { startFeed, type Feed } from './feed'
import { HUB_ID, type CatalogEntry } from './install'
import type { Channel, UpdateState } from './state'

/**
 * What self-update needs from electron-updater: check the feed at `url`, download, and install on quit;
 * `allowDowngrade` only when the served version is older, after a channel switch (S2).
 */
export interface Updater {
  check(url: string, options: { allowDowngrade: boolean }): Promise<void>
}

/** What one report led to. */
export type SelfUpdateOutcome =
  { status: 'served'; version: string } | { status: 'skipped' | 'failed'; reason: string }

/** The self-update the wiring drives with each check report. */
export interface SelfUpdate {
  onReport(
    report: CheckReport,
    engine: Pick<UpdateEngine, 'stageInstaller' | 'readState'>
  ): Promise<SelfUpdateOutcome>
  /** Stops the feed. */
  stop(): Promise<void>
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
function isNewer(candidate: string, current: string): boolean {
  const [next, now] = [versionKey(candidate), versionKey(current)]
  if (!next || !now) return false
  return (next.map((part, position) => part - Number(now[position])).find((diff) => diff !== 0) ?? 0) > 0
}

/** The channel a release version belongs to: `beta` for a `-beta.N` prerelease. */
function versionChannel(version: string): Channel {
  return version.includes('-beta.') ? 'beta' : 'stable'
}

/**
 * The hub entry offered on the hub's channel and whether serving it is a downgrade, or why there is none. A
 * downgrade only after the user chose a channel other than the running version's (odd/tasks/channels.md S2).
 */
function hubUpdate(
  { catalog, installId }: NonNullable<CheckReport['verified']>,
  state: UpdateState,
  currentVersion: string
): { entry: CatalogEntry; allowDowngrade: boolean } | { status: 'skipped'; reason: string } {
  const channel = channelOf(state, HUB_ID)
  const entry = catalog.components.find(
    (item) => item.id === HUB_ID && item.kind === 'hub' && offered(item, channel, installId)
  )
  if (!entry) return { status: 'skipped', reason: 'no_hub_entry' }
  if (isNewer(entry.version, currentVersion)) return { entry, allowDowngrade: false }
  const switched = state.hub !== undefined && versionChannel(currentVersion) !== channel
  if (!switched || entry.version === currentVersion) return { status: 'skipped', reason: 'not_newer' }
  return { entry, allowDowngrade: true }
}

/** A self-update for a hub running `currentVersion`, installing through `updater`. */
export function createSelfUpdate({
  currentVersion,
  updater
}: {
  currentVersion: string
  updater: Updater
}): SelfUpdate {
  let served: { version: string; feed: Feed } | undefined
  return {
    async onReport(report, engine) {
      if (!report.verified) return { status: 'skipped', reason: 'no_catalog' }
      const { keys } = report.verified
      const choice = hubUpdate(report.verified, await engine.readState(), currentVersion)
      if ('status' in choice) return choice
      const { entry, allowDowngrade } = choice
      if (served?.version === entry.version) return { status: 'skipped', reason: 'already_served' }
      const installer = await engine.stageInstaller(entry, keys)
      if (typeof installer === 'string') return { status: 'failed', reason: installer }
      await served?.feed.close()
      served = { version: entry.version, feed: await startFeed(installer) }
      try {
        await updater.check(served.feed.url, { allowDowngrade })
      } catch (error) {
        // Not served after all: the next report stages (already downloaded, verified again) and retries.
        await served.feed.close()
        served = undefined
        return {
          status: 'failed',
          reason: `updater: ${String(error)}`
        }
      }
      return { status: 'served', version: entry.version }
    },
    async stop() {
      await served?.feed.close()
      served = undefined
    }
  }
}
