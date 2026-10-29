// The hub's self-update (odd/tasks/update-engine.md S4, ADR D10): after each verified catalog check, the
// newest `stylistic-hub` entry offered on the hub's channel (odd/tasks/channels.md S1-S4,
// odd/tasks/catalog-auto-update.md S1-S2) and newer than the running hub, or older after a channel switch, is
// downloaded and verified by the engine, served from the loopback feed, and only then handed to electron-updater,
// which re-checks its sha512 and installs it on quit.
import type { HubUpdateStatus } from '../../shared/bridge'
import { channelOf, isNewer, newestOffered } from './channels'
import type { CheckReport, UpdateEngine } from './engine'
import { startFeed, type Feed } from './feed'
import { HUB_ID, type CatalogEntry } from './install'
import type { UpdateState } from './state'

/**
 * What self-update needs from electron-updater: check the feed at `url`, download, and install on quit;
 * `allowDowngrade` only when the served version is older, after a channel switch (S2).
 */
export interface Updater {
  check(url: string, options: { allowDowngrade: boolean }): Promise<void>
  /** Withdraws the downloaded installer from install on quit: the hub's channel no longer offers it. */
  cancel(): void
  /** Quits the hub now and runs the downloaded installer, which starts the hub again. */
  install(): void
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
  /** Where the hub's own update stands, for the Library; undefined before the first verified catalog. */
  status(): HubUpdateStatus | undefined
  /** Quits and installs the `ready` version now; throws `no_update_ready` when there is none. */
  restart(): void
  /** Stops the feed. */
  stop(): Promise<void>
}

/**
 * The newest hub entry offered on the hub's channel and whether serving it is a downgrade, or why there is none.
 * A downgrade only after the user switched a beta hub to stable (odd/tasks/channels.md S2): beta also offers
 * stable, so a switch to beta never goes back (odd/tasks/catalog-auto-update.md S2).
 */
function hubUpdate(
  { catalog, installId }: NonNullable<CheckReport['verified']>,
  state: UpdateState,
  currentVersion: string
): { entry: CatalogEntry; allowDowngrade: boolean } | { status: 'skipped'; reason: string } {
  const channel = channelOf(state, HUB_ID)
  const hubs = catalog.components.filter((item) => item.id === HUB_ID && item.kind === 'hub')
  const entry = newestOffered(hubs, channel, installId)
  if (!entry) return { status: 'skipped', reason: 'no_hub_entry' }
  if (isNewer(entry.version, currentVersion)) return { entry, allowDowngrade: false }
  const switched = state.hub !== undefined && channel === 'stable' && currentVersion.includes('-beta.')
  if (!switched || entry.version === currentVersion) return { status: 'skipped', reason: 'not_newer' }
  return { entry, allowDowngrade: true }
}

/**
 * A self-update for a hub running `currentVersion`, installing through `updater`; `onStatus` hears each change of
 * `status()`, so the Library can show it while it happens.
 */
export function createSelfUpdate({
  currentVersion,
  updater,
  onStatus
}: {
  currentVersion: string
  updater: Updater
  onStatus?: (status: HubUpdateStatus) => void
}): SelfUpdate {
  let served: { version: string; feed: Feed } | undefined
  let current: HubUpdateStatus | undefined
  const set = (status: HubUpdateStatus) => {
    current = status
    onStatus?.(status)
  }
  return {
    async onReport(report, engine) {
      if (!report.verified) return { status: 'skipped', reason: 'no_catalog' }
      const { keys } = report.verified
      const choice = hubUpdate(report.verified, await engine.readState(), currentVersion)
      if ('status' in choice) {
        // A served installer the channel no longer offers (a switch back before restarting) must not install on quit.
        if (served) {
          await served.feed.close()
          served = undefined
          updater.cancel()
        }
        set({ state: 'up-to-date' })
        return choice
      }
      const { entry, allowDowngrade } = choice
      const { version } = entry
      if (served?.version === version) return { status: 'skipped', reason: 'already_served' }
      set({ state: 'downloading', version })
      const installer = await engine.stageInstaller(entry, keys)
      if (typeof installer === 'string') {
        set({ state: 'failed', version, reason: installer })
        return { status: 'failed', reason: installer }
      }
      await served?.feed.close()
      served = { version, feed: await startFeed(installer) }
      try {
        await updater.check(served.feed.url, { allowDowngrade })
      } catch (error) {
        // Not served after all: the next report stages (already downloaded, verified again) and retries.
        await served.feed.close()
        served = undefined
        const reason = `updater: ${String(error)}`
        set({ state: 'failed', version, reason })
        return { status: 'failed', reason }
      }
      set({ state: 'ready', version })
      return { status: 'served', version }
    },
    status: () => current,
    restart() {
      if (current?.state !== 'ready') throw new Error('no_update_ready')
      updater.install()
    },
    async stop() {
      await served?.feed.close()
      served = undefined
    }
  }
}
