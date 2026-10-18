// The update engine (odd/tasks/update-engine.md S2): one catalog check, revocation of installed versions whose
// key is gone, and the install of the catalog's stable version of the server and of what is already installed.
import type { KeyList } from '../../shared/signing/documents'
import { checkCatalog, type CatalogCheck, type EngineContext } from './catalog'
import { installComponent, readInstalled, type CatalogEntry, type InstallOutcome } from './install'
import { addHistory, componentState, readState, updateState, type UpdateState } from './state'

/** The only channel M4 follows (M6 adds the choice). */
const CHANNEL = 'stable'

/** What one full check did: the catalog verdict and each install it attempted. */
export interface CheckReport {
  catalog: 'ok' | string
  installs: { id: string; version: string; outcome: InstallOutcome }[]
}

/** The engine T3 and T4 drive: catalog check, install, state, and the rollback primitives. */
export interface UpdateEngine {
  checkCatalog(): Promise<CatalogCheck>
  installComponent(entry: CatalogEntry, keys: KeyList): Promise<InstallOutcome>
  readState(): Promise<UpdateState>
  markBad(id: string, version: string, reason: string): Promise<void>
  setCurrent(id: string, version: string): Promise<void>
  /** A catalog check, revocation, then the installs the catalog calls for. */
  runCheck(): Promise<CheckReport>
}

/** Disables every installed version whose signing key the verified key list no longer names. */
async function revoke(context: EngineContext, keys: KeyList): Promise<void> {
  const listed = new Set<string | null>(keys.keys.map((key) => key.id))
  const state = await readState(context.root)
  const revokedPrevious = new Set<string>()
  for (const [id, { previous }] of Object.entries(state.components)) {
    if (previous && !listed.has((await readInstalled(context.root, id, previous)).envelope.keyId)) {
      revokedPrevious.add(id)
    }
  }
  await updateState(context.root, (next) => {
    for (const [id, component] of Object.entries(next.components)) {
      if (revokedPrevious.has(id)) component.previous = null
      if (!component.current || listed.has(component.keyId)) continue
      addHistory(next, {
        time: context.now().toISOString(),
        component: id,
        from: component.current,
        to: null,
        outcome: 'disabled',
        reason: 'revoked_key'
      })
      component.current = null
      component.keyId = null
    }
  })
}

/** Whether the engine installs `entry` now: stable, the server or already installed, new, never marked bad. */
function wanted(state: UpdateState, entry: CatalogEntry): boolean {
  const installed = state.components[entry.id]
  if (entry.channel !== CHANNEL || (entry.kind !== 'server' && !installed)) return false
  return installed?.current !== entry.version && !installed?.bad.includes(entry.version)
}

/** An update engine over the components directory `context.root`, trusting `rootKeys` for `keys.json`. */
export function createUpdateEngine(context: EngineContext, rootKeys: readonly Buffer[]): UpdateEngine {
  const engine: UpdateEngine = {
    checkCatalog: () => checkCatalog(context, rootKeys),
    installComponent: (entry, keys) => installComponent(context, entry, keys),
    readState: () => readState(context.root),
    async markBad(id, version, reason) {
      await updateState(context.root, (state) => {
        const component = componentState(state, id)
        if (!component.bad.includes(version)) component.bad.push(version)
        const time = context.now().toISOString()
        addHistory(state, { time, component: id, from: version, to: null, outcome: 'marked_bad', reason })
      })
    },
    async setCurrent(id, version) {
      const { envelope } = await readInstalled(context.root, id, version)
      await updateState(context.root, (state) => {
        const component = componentState(state, id)
        const time = context.now().toISOString()
        addHistory(state, {
          time,
          component: id,
          from: component.current,
          to: version,
          outcome: 'switched',
          reason: null
        })
        component.previous = component.current
        component.current = version
        component.keyId = envelope.keyId
      })
    },
    async runCheck() {
      const check = await engine.checkCatalog()
      if (check.status !== 'ok') return { catalog: check.reason, installs: [] }
      await revoke(context, check.keys)
      const state = await readState(context.root)
      const installs: CheckReport['installs'] = []
      for (const entry of check.catalog.components.filter((item) => wanted(state, item))) {
        const outcome = await installComponent(context, entry, check.keys)
        installs.push({ id: entry.id, version: entry.version, outcome })
      }
      return { catalog: 'ok', installs }
    }
  }
  return engine
}
