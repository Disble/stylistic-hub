// The update engine (odd/tasks/update-engine.md S2): one catalog check, revocation of installed versions whose
// key is gone, and the install of the version offered on each component's channel (odd/tasks/channels.md S1, S3,
// S4) for the server and for what is already installed.
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { componentSchema, type Catalog, type KeyList } from '../../shared/signing/documents'
import { checkCatalog, type CatalogCheck, type EngineContext } from './catalog'
import { channelOf, offered } from './channels'
import type { StagedInstaller } from './feed'
import {
  HUB_ID,
  installComponent,
  readInstalled,
  stageHubInstaller,
  type CatalogEntry,
  type InstallOutcome
} from './install'
import { addHistory, componentState, readState, updateState, type Channel, type UpdateState } from './state'

/** What one full check did: the catalog verdict and each install it attempted. */
export interface CheckReport {
  catalog: 'ok' | string
  installs: { id: string; version: string; outcome: InstallOutcome }[]
  /** The verified catalog, key list and install id when `catalog` is `ok`, for the hub's self-update (S4). */
  verified?: { catalog: Catalog; keys: KeyList; installId: string }
}

/** The engine T3 and T4 drive: catalog check, install, state, and the rollback primitives. */
export interface UpdateEngine {
  checkCatalog(): Promise<CatalogCheck>
  installComponent(entry: CatalogEntry, keys: KeyList): Promise<InstallOutcome>
  /** Downloads and verifies the hub installer of `entry` into staging, without installing it (S4). */
  stageInstaller(entry: CatalogEntry, keys: KeyList): Promise<StagedInstaller | string>
  readState(): Promise<UpdateState>
  markBad(id: string, version: string, reason: string): Promise<void>
  /** Switches `current` to an installed version; `reason` goes into the history line (null when none). */
  setCurrent(id: string, version: string, reason?: string | null): Promise<void>
  /** Sets the channel component `id` follows (`HUB_ID`: the hub's own); the next check applies it. */
  setChannel(id: string, channel: Channel): Promise<void>
  /** Records that the user wants module `id`; the next check installs it as it updates installed ones (S2). */
  requestInstall(id: string): Promise<void>
  /** Removes module `id`: its state entry, with a history line, then `<root>/<id>/` (S2). */
  uninstall(id: string): Promise<void>
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

/**
 * Whether the engine installs `entry` now: offered to this install on the component's channel, the server or
 * already installed, not the current version, never marked bad. An older version is a switch back (S2).
 */
function wanted(state: UpdateState, entry: CatalogEntry, installId: string): boolean {
  const installed = state.components[entry.id]
  if (!offered(entry, channelOf(state, entry.id), installId) || (entry.kind !== 'server' && !installed))
    return false
  return installed?.current !== entry.version && !installed?.bad.includes(entry.version)
}

/** `id` when it is a component id other than the server's and the hub's; throws otherwise. */
function moduleId(id: string): string {
  const module = componentSchema.shape.id.parse(id)
  if (module === 'server' || module === HUB_ID) throw new Error(`${module} is not a module`)
  return module
}

/** This install's id, created at the first check that needs it and kept from then on (S3). */
async function installIdOf(root: string): Promise<string> {
  let installId = ''
  await updateState(root, (state) => {
    state.installId ??= randomUUID()
    installId = state.installId
  })
  return installId
}

/** An update engine over the components directory `context.root`, trusting `rootKeys` for `keys.json`. */
export function createUpdateEngine(context: EngineContext, rootKeys: readonly Buffer[]): UpdateEngine {
  const engine: UpdateEngine = {
    checkCatalog: () => checkCatalog(context, rootKeys),
    installComponent: (entry, keys) => installComponent(context, entry, keys),
    stageInstaller: (entry, keys) => stageHubInstaller(context, entry, keys),
    readState: () => readState(context.root),
    async markBad(id, version, reason) {
      await updateState(context.root, (state) => {
        const component = componentState(state, id)
        if (!component.bad.includes(version)) component.bad.push(version)
        const time = context.now().toISOString()
        addHistory(state, { time, component: id, from: version, to: null, outcome: 'marked_bad', reason })
      })
    },
    async setCurrent(id, version, reason = null) {
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
          reason
        })
        component.previous = component.current
        component.current = version
        component.keyId = envelope.keyId
      })
    },
    async setChannel(id, channel) {
      await updateState(context.root, (state) => {
        if (id === HUB_ID) state.hub = { channel }
        else componentState(state, id).channel = channel
      })
    },
    async requestInstall(id) {
      const module = moduleId(id)
      await updateState(context.root, (state) => {
        componentState(state, module)
      })
    },
    async uninstall(id) {
      const module = moduleId(id)
      await updateState(context.root, (state) => {
        const installed = state.components[module]
        if (!installed) throw new Error(`${module} is not installed`)
        delete state.components[module]
        const time = context.now().toISOString()
        const from = installed.current
        addHistory(state, { time, component: module, from, to: null, outcome: 'uninstalled', reason: null })
      })
      await rm(join(context.root, module), { recursive: true, force: true })
    },
    async runCheck() {
      const check = await engine.checkCatalog()
      if (check.status !== 'ok') return { catalog: check.reason, installs: [] }
      await revoke(context, check.keys)
      const installId = await installIdOf(context.root)
      const state = await readState(context.root)
      const installs: CheckReport['installs'] = []
      for (const entry of check.catalog.components.filter((item) => wanted(state, item, installId))) {
        const outcome = await installComponent(context, entry, check.keys)
        installs.push({ id: entry.id, version: entry.version, outcome })
      }
      return { catalog: 'ok', installs, verified: { catalog: check.catalog, keys: check.keys, installId } }
    }
  }
  return engine
}
