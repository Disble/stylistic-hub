// The Library screen's data and actions (odd/tasks/module-library.md S5): one entry per component, from
// `state.json` and the last catalog a check verified, which only this module keeps (in memory, since it opened).
import type { Library, LibraryComponent } from '../shared/bridge'
import { channelOf, newestOffered } from './updates/channels'
import type { CheckReport, UpdateEngine } from './updates/engine'
import { HUB_ID, type CatalogEntry } from './updates/install'
import type { SelfUpdate } from './updates/self-update'
import type { UpdateState } from './updates/state'

/** How many history lines each card shows. */
export const HISTORY_LINES = 5

/** The part of a successful check the library reads. */
type Verified = { catalog: { components: CatalogEntry[] }; installId: string }

/** The card kind of component `id`. */
function kindOf(id: string): LibraryComponent['kind'] {
  if (id === 'server') return 'server'
  return id === HUB_ID ? 'hub' : 'module'
}

/**
 * The cards: the server and the hub always, then every module in the state or in the catalog. `available` is the
 * newest catalog entry offered on the component's channel, the one the engine installs; `hubReady`, the hub update
 * already downloaded, which installs when the hub restarts.
 */
export function buildLibrary(
  state: UpdateState,
  verified: Verified | undefined,
  hubVersion: string,
  hubReady?: string
): Library {
  const entries = verified?.catalog.components ?? []
  const modules = [...new Set([...Object.keys(state.components), ...entries.map((entry) => entry.id)])]
    .filter((id) => kindOf(id) === 'module')
    .sort()
  const components = ['server', HUB_ID, ...modules].map((id): LibraryComponent => {
    const channel = channelOf(state, id)
    const entry = state.components[id]
    const available =
      verified &&
      newestOffered(
        entries.filter((e) => e.id === id),
        channel,
        verified.installId
      )
    return {
      id,
      kind: kindOf(id),
      installed: id === HUB_ID ? hubVersion : (entry?.current ?? null),
      requested: Boolean(entry && !entry.current),
      channel,
      available: available ? available.version : null,
      ...(id === HUB_ID && hubReady && { ready: hubReady }),
      history: state.history
        .filter((line) => line.component === id)
        .slice(-HISTORY_LINES)
        .reverse()
        .map(({ time, from, to, outcome, reason }) => ({ time, from, to, outcome, reason }))
    }
  })
  return { firstRun: !state.components['server']?.current, catalog: Boolean(verified), components }
}

/**
 * The library over `engine`: `observe` keeps each check's verified catalog; `check` runs a catalog check now;
 * `restart` quits the hub into the update `hubUpdate` downloaded.
 */
export function createLibrary({
  engine,
  check,
  hubVersion,
  hubUpdate = { ready: () => undefined, restart: () => undefined }
}: {
  engine: Pick<UpdateEngine, 'readState' | 'requestInstall' | 'uninstall'>
  check: () => void
  hubVersion: string
  hubUpdate?: Pick<SelfUpdate, 'ready' | 'restart'>
}) {
  let verified: Verified | undefined
  return {
    observe(report: CheckReport): void {
      if (report.verified) verified = report.verified
    },
    async list(): Promise<Library> {
      return buildLibrary(await engine.readState(), verified, hubVersion, hubUpdate.ready())
    },
    async restart(): Promise<void> {
      hubUpdate.restart()
    },
    /** The engine installs a requested module at the next check, so one runs right away. */
    async install(id: string): Promise<void> {
      await engine.requestInstall(id)
      check()
    },
    /** The check that follows refreshes the module switch: the module stops being served and registered in Word. */
    async uninstall(id: string): Promise<void> {
      await engine.uninstall(id)
      check()
    },
    check
  }
}
