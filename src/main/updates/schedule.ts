// Wiring of the update engine for the main process: real clock, the embedded root keys, a check at start and
// every `intervalMs` (6 hours), never two at once. app.ts calls it with Electron's userData and fetch;
// `onReport` (the hub's self-update, S4) runs after each check, inside the same no-overlap guard. `check()` runs
// one now (a channel change, odd/tasks/channels.md S5), or once more right after the one running.
import { join } from 'node:path'
import { createUpdateEngine, type CheckReport, type UpdateEngine } from './engine'
import { ROOT_KEYS } from './trust'

/** Six hours between catalog checks. */
const SIX_HOURS = 6 * 60 * 60 * 1000

/** Starts the periodic checks over `<userData>/components`; returns the engine, a check now and a stop function. */
export function startUpdateChecks({
  userData,
  database,
  fetch,
  intervalMs = SIX_HOURS,
  log = console.error,
  onChecked = () => undefined,
  onReport
}: {
  userData: string
  /** The server's database, for the schema guard of server installs (odd/tasks/channels.md S2). */
  database: string
  fetch: typeof globalThis.fetch
  intervalMs?: number
  log?: (message: string) => void
  /** Called after each check that ran, so the hub can move to a server version it installed. */
  onChecked?: (report: CheckReport) => void
  onReport?: (report: CheckReport, engine: UpdateEngine) => Promise<void>
}): { engine: UpdateEngine; check: () => void; stop: () => void } {
  const engine = createUpdateEngine(
    { fetch, root: join(userData, 'components'), now: () => new Date(), database },
    ROOT_KEYS
  )
  const once = async () => {
    try {
      const report = await engine.runCheck()
      log(`update check: catalog ${report.catalog}, ${JSON.stringify(report.installs)}`)
      onChecked(report)
      await onReport?.(report, engine)
    } catch (error) {
      log(`update check failed: ${String(error)}`)
    }
  }
  let running = false
  /** Asked for while a check runs: one more check right after it. */
  let again = false
  const run = async (): Promise<void> => {
    if (running) {
      again = true
      return
    }
    running = true
    await once()
    running = false
    if (again) {
      again = false
      await run()
    }
  }
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  return { engine, check: () => void run(), stop: () => clearInterval(timer) }
}
