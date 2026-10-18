// Wiring of the update engine for the main process: real clock, the embedded root keys, a check at start and
// every `intervalMs` (6 hours), never two at once. app.ts calls it with Electron's userData and fetch;
// `onReport` (the hub's self-update, S4) runs after each check, inside the same no-overlap guard.
import { join } from 'node:path'
import { createUpdateEngine, type CheckReport, type UpdateEngine } from './engine'
import { ROOT_KEYS } from './trust'

/** Six hours between catalog checks. */
const SIX_HOURS = 6 * 60 * 60 * 1000

/** Starts the periodic checks over `<userData>/components`; returns the engine and a stop function. */
export function startUpdateChecks({
  userData,
  fetch,
  intervalMs = SIX_HOURS,
  log = console.error,
  onChecked = () => undefined,
  onReport
}: {
  userData: string
  fetch: typeof globalThis.fetch
  intervalMs?: number
  log?: (message: string) => void
  /** Called after each check that ran, so the hub can move to a server version it installed. */
  onChecked?: () => void
  onReport?: (report: CheckReport, engine: UpdateEngine) => Promise<void>
}): { engine: UpdateEngine; stop: () => void } {
  const engine = createUpdateEngine(
    { fetch, root: join(userData, 'components'), now: () => new Date() },
    ROOT_KEYS
  )
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      const report = await engine.runCheck()
      log(`update check: catalog ${report.catalog}, ${JSON.stringify(report.installs)}`)
      onChecked()
      await onReport?.(report, engine)
    } catch (error) {
      log(`update check failed: ${String(error)}`)
    } finally {
      running = false
    }
  }
  void run()
  const timer = setInterval(() => void run(), intervalMs)
  return { engine, stop: () => clearInterval(timer) }
}
