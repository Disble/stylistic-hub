// Which modules the backend serves at `/m/<id>/`, and the rollback when a module version fails
// (odd/tasks/module-library.md S3, S7): the current version of each installed office-addin module, else
// `--module <id>=<dir>` in development, reach the backend through `STYLISTIC_MODULES`. After a version switch
// the stable `components/<id>/manifest.xml` is written from it and the module must answer its health check, or
// it is marked bad and goes back to the previous version, as server-switch.ts does for the server.
import { existsSync, readFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { componentSchema } from '../shared/signing/documents'
import type { UpdateEngine } from './updates/engine'
import { readInstalled } from './updates/install'

/**
 * The API scopes the backend accepts in `STYLISTIC_MODULES` (`API_SCOPES` in
 * src/backend/adapters/http/module-tokens.ts; the shell may not import the backend, and a test compares the two).
 * An unknown scope would stop the backend at startup, so a module's other declared scopes are left out.
 */
export const MODULE_SCOPES = [
  'status',
  'documents',
  'analyses',
  'feedback',
  'preferences',
  'modules'
] as const

/** The only module kind served under `/m/<id>/` (ADR 0001 D1). */
const MODULE_KIND = 'office-addin'

/** `STYLISTIC_MODULES`: each served module's directory and the API scopes its token may call. */
type ModuleSet = Record<string, { dir: string; scopes: string[] }>

/** The `<Version>` the backend requires in a module's manifest.xml (src/backend/modules.ts). */
const MANIFEST_VERSION = /<Version>\s*([^<\s]+)\s*<\/Version>/

/** Whether the backend would serve `dir`: a missing manifest or version stops it at startup. */
function servable(dir: string): boolean {
  const manifest = join(dir, 'manifest.xml')
  return existsSync(manifest) && MANIFEST_VERSION.test(readFileSync(manifest, 'utf8'))
}

/**
 * Every `--module <id>=<dir>` an unpackaged hub was started with, as absolute directories (development only,
 * D12). A value without `=`, with no directory or with an invalid component id is ignored.
 */
export function moduleDirFlags(argv: readonly string[], packaged: boolean): Record<string, string> {
  const modules: Record<string, string> = {}
  if (packaged) return modules
  argv.forEach((arg, index) => {
    const value = arg === '--module' ? (argv[index + 1] ?? '') : ''
    const at = value.indexOf('=')
    const id = value.slice(0, at)
    const dir = value.slice(at + 1)
    if (at > 0 && dir && componentSchema.shape.id.safeParse(id).success) modules[id] = resolve(dir)
  })
  return modules
}

/** The stable manifest Word registers for module `id` (S4). */
function stableManifest(componentsRoot: string, id: string): string {
  return join(componentsRoot, id, 'manifest.xml')
}

/**
 * How the backend serves version `version` of installed component `id`: its directory and the known scopes its
 * verified component.json declares in `requires.scopes`; undefined when it is not a servable office-addin module.
 */
async function servedVersion(
  componentsRoot: string,
  id: string,
  version: string
): Promise<{ dir: string; scopes: string[] } | undefined> {
  const dir = join(componentsRoot, id, version)
  const record = await readInstalled(componentsRoot, id, version).catch(() => undefined)
  if (record?.component.kind !== MODULE_KIND || !servable(dir)) return undefined
  const declared = [record.component.requires['scopes']].flat()
  return { dir, scopes: MODULE_SCOPES.filter((scope) => declared.includes(scope)) }
}

/** What the switch needs from the backend process. */
export interface ModuleBackend {
  /** The `STYLISTIC_MODULES` value of the next start; undefined leaves the variable out. */
  setModules(value: string | undefined): void
  /** Stops the backend and starts it again; not counted as a crash. */
  restart(): void
}

/** Serves the installed modules and rolls a failing module version back. */
export function createModuleSwitch({
  engine,
  componentsRoot,
  devModules,
  backend,
  restartAllowed,
  healthy,
  serverHealthy,
  onChange,
  report,
  log = console.warn
}: {
  engine: Pick<UpdateEngine, 'readState' | 'markBad' | 'setCurrent'>
  componentsRoot: string
  /** `--module <id>=<dir>`: served with every scope in place of an installed version, with no health check. */
  devModules: Record<string, string>
  backend: ModuleBackend
  /** False while the server switch rolls back: it starts the backend itself, with the modules set here. */
  restartAllowed: () => boolean
  /** Waits for module `id`'s manifest and task pane at `/m/<id>/`: true when both answered 200 in time. */
  healthy: (id: string) => Promise<boolean>
  /** Waits for the server's own health check; a module gets no verdict while the server is down. */
  serverHealthy: () => Promise<boolean>
  /** Told when the served modules Word should register changed: a module passed its check or left the set. */
  onChange: () => void
  /** Why a module version was rolled back, for the Server screen. */
  report: (message: string) => void
  log?: (message: string) => void
}) {
  /** The value last given to the backend; undefined until `start`. */
  let served: string | undefined
  let started = false
  /** The installed version served per module id, excluding `--module` overrides. */
  let versions = new Map<string, string>()
  /** Bumped per module on every switch, so a late health result of an older version is ignored. */
  const generations = new Map<string, number>()
  /** The tail of the chain of `apply` calls: a refresh and a rollback never compute the set at the same time. */
  let queue: Promise<unknown> = Promise.resolve()

  /** The served set for the current state: current, not bad, servable versions, then the `--module` overrides. */
  const resolveModules = async () => {
    const state = await engine.readState().catch((error: unknown) => {
      log(`cannot read the update state: ${String(error)}`)
      return undefined
    })
    const candidates = Object.entries(state?.components ?? {}).flatMap(([id, { current, bad }]) =>
      current && !bad.includes(current) && !devModules[id] ? [[id, current] as const] : []
    )
    const resolved = await Promise.all(
      candidates.map(async ([id, version]) => ({
        id,
        version,
        served: await servedVersion(componentsRoot, id, version)
      }))
    )
    const modules: ModuleSet = {}
    const installed = new Map<string, string>()
    for (const { id, version, served } of resolved) {
      if (!served) continue
      modules[id] = served
      installed.set(id, version)
    }
    for (const [id, dir] of Object.entries(devModules)) {
      if (servable(dir)) modules[id] = { dir, scopes: [...MODULE_SCOPES] }
      else log(`--module ${id}: ${dir} has no manifest.xml with a <Version>, so it is not served`)
    }
    return { modules, installed }
  }

  /** Waits for the health check of `id` at `version`, whose stable manifest is written; `run` is its generation. */
  const check = async (id: string, version: string, run: number): Promise<void> => {
    if (!(await serverHealthy())) {
      log(`module ${id} ${version}: the server is not healthy, so its health check gives no verdict`)
      return
    }
    const ok = await healthy(id)
    if (run !== generations.get(id)) return
    if (ok) onChange()
    else await rollBack(id, version)
  }

  /** Gives the backend `modules` when they differ from what it serves, restarting it when `restart` allows. */
  const setBackend = (modules: ModuleSet, restart: boolean) => {
    const value = Object.keys(modules).length > 0 ? JSON.stringify(modules) : undefined
    if (started && value === served) return
    backend.setModules(value)
    if (started && restart && restartAllowed()) backend.restart()
    served = value
    started = true
  }

  /** Writes the stable manifest of `id` from `version`, then starts its health check (in an object, not awaited). */
  const switchTo = async (id: string, version: string): Promise<{ check: Promise<void> }> => {
    // A newer switch, or the module leaving and coming back, makes any older check late.
    const run = (generations.get(id) ?? 0) + 1
    generations.set(id, run)
    await copyFile(
      join(componentsRoot, id, version, 'manifest.xml'),
      stableManifest(componentsRoot, id)
    ).catch((error: unknown) =>
      log(`module ${id} ${version}: cannot write its stable manifest: ${String(error)}`)
    )
    return {
      check: check(id, version, run).catch((error: unknown) =>
        log(`module ${id} ${version}: ${String(error)}`)
      )
    }
  }

  /**
   * Gives the backend the resolved set, then writes the stable manifests of the modules whose version changed;
   * resolves to their health checks.
   */
  const apply = (restart: boolean): Promise<Promise<void>[]> => {
    const next = queue.then(async () => {
      const { modules, installed } = await resolveModules()
      setBackend(modules, restart)
      const before = versions
      versions = installed
      if ([...before.keys()].some((id) => !installed.has(id))) onChange()
      const switched = [...installed].filter(([id, version]) => before.get(id) !== version)
      const checks = await Promise.all(switched.map(([id, version]) => switchTo(id, version)))
      return checks.map(({ check }) => check)
    })
    queue = next.catch(() => undefined)
    return next
  }

  /** Marks `failed` bad and goes back to the previous version, or stops serving the module when there is none. */
  const rollBack = async (id: string, failed: string): Promise<void> => {
    const what = `Module ${id} ${failed} failed its health check`
    try {
      await engine.markBad(id, failed, 'health_check_failed')
      const module = (await engine.readState()).components[id]
      const previous = module?.previous
      if (previous && !module.bad.includes(previous)) {
        await engine.setCurrent(id, previous)
        report(`${what}; the hub went back to ${previous}.`)
      } else {
        report(`${what}; no earlier version is installed, so it is not served.`)
      }
    } catch (error) {
      log(`module rollback failed: ${String(error)}`)
      report(`${what}; the rollback failed: ${String(error)}`)
    }
    // The bad version is no longer resolved: the previous one is served, or none.
    await Promise.all(await apply(true))
  }

  return {
    /** Gives the backend the modules to serve before its first start; the health checks run in the background. */
    async start(): Promise<void> {
      await apply(false)
    },
    /** After a catalog check (or an install or uninstall): restarts the backend when the served set changed. */
    async refresh(): Promise<void> {
      if (started) await apply(true)
    },
    /** The stable manifests of the installed modules served now, for Word's registration (S4). */
    manifests: (): string[] => [...versions.keys()].map((id) => stableManifest(componentsRoot, id))
  }
}
