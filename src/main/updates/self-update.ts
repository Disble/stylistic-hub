// The hub's self-update (odd/tasks/update-engine.md S4, ADR D10): after each verified catalog check, the stable
// `stylistic-hub` entry newer than the running hub is downloaded and verified by the engine, served from the
// loopback feed, and only then handed to electron-updater, which re-checks its sha512 and installs it on quit.
import type { CheckReport, UpdateEngine } from './engine'
import { startFeed, type Feed } from './feed'
import { HUB_ID } from './install'

/** What self-update needs from electron-updater: check the feed at `url`, download, and install on quit. */
export interface Updater {
  check(url: string): Promise<void>
}

/** What one report led to. */
export type SelfUpdateOutcome =
  { status: 'served'; version: string } | { status: 'skipped' | 'failed'; reason: string }

/** The self-update the wiring drives with each check report. */
export interface SelfUpdate {
  onReport(report: CheckReport, engine: Pick<UpdateEngine, 'stageInstaller'>): Promise<SelfUpdateOutcome>
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
      const { catalog, keys } = report.verified
      const entry = catalog.components.find(
        (item) => item.id === HUB_ID && item.kind === 'hub' && item.channel === 'stable'
      )
      if (!entry) return { status: 'skipped', reason: 'no_hub_entry' }
      if (!isNewer(entry.version, currentVersion)) return { status: 'skipped', reason: 'not_newer' }
      if (served?.version === entry.version) return { status: 'skipped', reason: 'already_served' }
      const installer = await engine.stageInstaller(entry, keys)
      if (typeof installer === 'string') return { status: 'failed', reason: installer }
      await served?.feed.close()
      served = { version: entry.version, feed: await startFeed(installer) }
      try {
        await updater.check(served.feed.url)
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
