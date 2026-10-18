// The Library screen's data and actions (odd/tasks/module-library.md S5): one entry per component, from
// `state.json` and the last catalog a check verified, which only this module keeps (in memory, since it opened).
import type { Library, LibraryComponent } from '../shared/bridge'
import { channelOf, offered } from './updates/channels'
import type { CheckReport, UpdateEngine } from './updates/engine'
import { HUB_ID, type CatalogEntry } from './updates/install'
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
 * last catalog entry offered on the component's channel (the engine's checks end on that one too).
 */
export function buildLibrary(
  state: UpdateState,
  verified: Verified | undefined,
  hubVersion: string
): Library {
  const entries = verified?.catalog.components ?? []
  const modules = [...new Set([...Object.keys(state.components), ...entries.map((entry) => entry.id)])]
    .filter((id) => kindOf(id) === 'module')
    .sort()
  const components = ['server', HUB_ID, ...modules].map((id): LibraryComponent => {
    const channel = channelOf(state, id)
    const entry = state.components[id]
    const available =
      verified && entries.filter((e) => e.id === id && offered(e, channel, verified.installId)).at(-1)
    return {
      id,
      kind: kindOf(id),
      installed: id === HUB_ID ? hubVersion : (entry?.current ?? null),
      requested: Boolean(entry && !entry.current),
      channel,
      available: available ? available.version : null,
      history: state.history
        .filter((line) => line.component === id)
        .slice(-HISTORY_LINES)
        .reverse()
        .map(({ time, from, to, outcome, reason }) => ({ time, from, to, outcome, reason }))
    }
  })
  return { firstRun: !state.components['server']?.current, catalog: Boolean(verified), components }
}

/** The library over `engine`: `observe` keeps each check's verified catalog; `check` runs a catalog check now. */
export function createLibrary({
  engine,
  check,
  hubVersion
}: {
  engine: Pick<UpdateEngine, 'readState' | 'requestInstall' | 'uninstall'>
  check: () => void
  hubVersion: string
}) {
  let verified: Verified | undefined
  return {
    observe(report: CheckReport): void {
      if (report.verified) verified = report.verified
    },
    async list(): Promise<Library> {
      return buildLibrary(await engine.readState(), verified, hubVersion)
    },
    /** The engine installs a requested module at the next check, so one runs right away. */
    async install(id: string): Promise<void> {
      await engine.requestInstall(id)
      check()
    },
    uninstall: (id: string) => engine.uninstall(id),
    check
  }
}
