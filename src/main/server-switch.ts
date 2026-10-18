// Which server the hub runs, and the rollback when a server version fails (odd/tasks/update-engine.md S3,
// ADR D6, D7): `--server <dir>` in development, else the current server component, else the built-in backend.
// After a start from a component the health check must pass; a failed check or a crash loop marks the version
// bad and goes back to the previous one, restoring the database backup only when a contract step was crossed.
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readSchemaState, restoreBackup } from '../shared/schema-state'
import type { UpdateEngine } from './updates/engine'
import { readInstalled } from './updates/install'
import type { ComponentState } from './updates/state'

/** The server's component id in the catalog and under `components/`. */
const SERVER_ID = 'server'

/** The file a server component forks (scripts/release/build-server.ts). */
const ENTRY = 'entry.js'

/** What the backend is forked from. */
export interface ServerTarget {
  entry: string
  /** The server component's version, or null for the built-in backend and `--server`. */
  component: string | null
  /** The version the Server screen shows. */
  version: string
}

/** The absolute directory after `--server`, if an unpackaged hub was started with one (development only). */
export function serverDirFlag(argv: readonly string[], packaged: boolean): string | undefined {
  const index = argv.indexOf('--server')
  const dir = index === -1 ? undefined : argv[index + 1]
  return packaged || !dir ? undefined : resolve(dir)
}

/** `--server <dir>`, else the current component when it is not bad and has its entry file, else the built-in. */
export function resolveServerTarget({
  devServerDir,
  componentsRoot,
  builtIn,
  server
}: {
  devServerDir?: string | undefined
  componentsRoot: string
  builtIn: { entry: string; version: string }
  server: ComponentState | undefined
}): ServerTarget {
  if (devServerDir) return { entry: join(devServerDir, ENTRY), component: null, version: 'development' }
  const current = server?.current
  if (current && !server.bad.includes(current)) {
    const entry = join(componentsRoot, SERVER_ID, current, ENTRY)
    if (existsSync(entry)) return { entry, component: current, version: current }
  }
  return { ...builtIn, component: null }
}

/** `backups/stylistic-schema<from>-<UTC yyyymmddHHMMss>.db`, as database.ts names them. */
const BACKUP_NAME = /^stylistic-schema(\d+)-(\d{14})\.db$/

/**
 * The readable backup beside `database` to restore for a server that writes `maxSchema`: the newest one taken at
 * exactly that schema, else the newest at the highest older schema.
 */
function newestBackup(database: string, maxSchema: number): string | undefined {
  const dir = join(dirname(database), 'backups')
  const candidates = (existsSync(dir) ? readdirSync(dir) : [])
    .flatMap((name) => {
      const match = BACKUP_NAME.exec(name)
      const schema = Number(match?.[1])
      return match && schema <= maxSchema ? [{ name, schema, stamp: match[2] ?? '' }] : []
    })
    .sort((a, b) => b.schema - a.schema || b.stamp.localeCompare(a.stamp))
  for (const { name } of candidates) {
    const file = join(dir, name)
    try {
      readSchemaState(file)
      return file
    } catch {
      // Not a readable database: try the next one.
    }
  }
  return undefined
}

/**
 * The data rule of a rollback to a server that writes `previousSchema`: nothing to do while the database's
 * `minReaderSchema` allows it (an expand step), else the newest backup from before the upgrade is restored,
 * or the rollback is refused when there is none. The backend must be stopped.
 */
function rollbackData(database: string, previousSchema: number): 'kept' | 'refused' | { restored: string } {
  if (!existsSync(database) || readSchemaState(database).minReaderSchema <= previousSchema) return 'kept'
  const backup = newestBackup(database, previousSchema)
  if (!backup) return 'refused'
  restoreBackup(database, backup)
  return { restored: basename(backup) }
}

/** What the switch needs from the backend process. */
export interface ServerBackend {
  /** Stops the running backend, if any, and starts it from `entry`. */
  startFrom(entry: string): Promise<void>
  /** Stops the backend and resolves once it has exited. */
  halt(): Promise<void>
}

/** The parts of the Server screen's status the switch sets. */
export interface SwitchStatus {
  setVersion(version: string): void
  rolledBack(reason: string): void
  setReason(reason: string): void
}

/** Runs the server from the right entry and rolls a failing server component back. */
export function createServerSwitch({
  engine,
  componentsRoot,
  database,
  builtIn,
  devServerDir,
  backend,
  healthy,
  status,
  log = console.warn
}: {
  engine: Pick<UpdateEngine, 'readState' | 'markBad' | 'setCurrent'>
  componentsRoot: string
  database: string
  builtIn: { entry: string; version: string }
  devServerDir?: string | undefined
  backend: ServerBackend
  /** Waits for the server's health check: true when it answered in time. */
  healthy: () => Promise<boolean>
  status: SwitchStatus
  log?: (message: string) => void
}) {
  let target: ServerTarget | undefined
  /** Bumped on every start and rollback, so a late health result of an older start is ignored. */
  let generation = 0
  let rollingBack = false
  /** A rollback was refused: the server stays stopped until a newer component is installed. */
  let refused = false

  /** The target for the current state; an unreadable state.json must not keep the server from starting. */
  const currentTarget = async () => {
    const server = await engine.readState().then(
      (state) => state.components[SERVER_ID],
      (error: unknown) => void log(`cannot read the update state: ${String(error)}`)
    )
    return resolveServerTarget({ devServerDir, componentsRoot, builtIn, server })
  }

  /** Starts `next`; a component must then pass its health check or it is rolled back. */
  const launch = async (next: ServerTarget): Promise<void> => {
    generation += 1
    const run = generation
    target = next
    refused = false
    status.setVersion(next.version)
    await backend.startFrom(next.entry)
    if (next.component === null) return
    if (!(await healthy()) && run === generation && !rollingBack) {
      await rollBack(next.component, 'health_check_failed')
    }
  }

  /** Marks `failed` bad and goes back to the previous version (or the built-in backend), applying the data rule. */
  const rollBack = async (failed: string, reason: 'health_check_failed' | 'crash_loop'): Promise<void> => {
    rollingBack = true
    generation += 1
    const what = `Server ${failed} ${reason === 'crash_loop' ? 'kept crashing' : 'failed its health check'}`
    let next: ServerTarget
    try {
      await backend.halt()
      await engine.markBad(SERVER_ID, failed, reason)
      const server = (await engine.readState()).components[SERVER_ID]
      const previous = server?.previous
      if (!previous || server.bad.includes(previous)) {
        status.rolledBack(`${what}; no earlier version is installed, so the built-in server runs.`)
        next = { ...builtIn, component: null }
      } else {
        const schema = (await readInstalled(componentsRoot, SERVER_ID, previous)).component.provides[
          'schemaVersion'
        ]
        const data = rollbackData(database, typeof schema === 'number' ? schema : 0)
        if (data === 'refused') {
          refused = true
          status.rolledBack(
            `${what}; the hub cannot go back to ${previous} because no readable backup of the database ` +
              'from before the upgrade exists. The server is stopped.'
          )
          return
        }
        const restored = data === 'kept' ? undefined : data.restored
        await engine.setCurrent(
          SERVER_ID,
          previous,
          restored ? `writes_since_upgrade_lost: ${restored}` : null
        )
        const lost = restored
          ? ` The database was restored from its backup ${restored}, so the changes made since then were lost.`
          : ''
        status.rolledBack(`${what}; the hub went back to ${previous}.${lost}`)
        next = {
          entry: join(componentsRoot, SERVER_ID, previous, ENTRY),
          component: previous,
          version: previous
        }
      }
    } catch (error) {
      log(`server rollback failed: ${String(error)}`)
      status.rolledBack(`${what}; the rollback failed: ${String(error)}`)
      return
    } finally {
      rollingBack = false
    }
    await launch(next)
  }

  return {
    /** Starts the backend from the resolved target (at hub start). */
    start: async () => launch(await currentTarget()),
    /** After a catalog check: moves to the newly resolved target when it changed. */
    async refresh() {
      if (rollingBack || !target) return
      const next = await currentTarget()
      if (next.entry === target?.entry || (refused && next.component === null)) return
      await launch(next)
    },
    /** False while a rollback runs, so the Server screen's Restart cannot start a backend over the restore. */
    restartAllowed: (): boolean => !rollingBack,
    /** The supervisor's crash-loop handler: true when the switch takes over with a rollback. */
    crashLoop(): boolean {
      if (rollingBack) return true
      const failed = target?.component
      if (!failed) {
        status.setReason('The server keeps crashing and there is no earlier version to go back to.')
        return false
      }
      void rollBack(failed, 'crash_loop')
      return true
    }
  }
}
