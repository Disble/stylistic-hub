import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { utilityProcess } from 'electron'
// fallow-ignore-next-line boundary-violation -- build-time bundle path for utilityProcess.fork, not a code import
import backendPath from '../backend/entry?modulePath'
import type { createServerStatus } from './server-status'
import type { ServerBackend } from './server-switch'
import { createSupervisor, type Supervisor } from './supervisor'

/** The built-in backend, bundled with the hub: the fallback until M5 downloads the server on first run. */
export const BUILT_IN_ENTRY = backendPath

/** What the backend process needs to start. */
export interface BackendOptions {
  certificatesDir: string
  database: string
  /** Pi's directory, shared with the main process's sign-in. */
  piDir: string
  port: number
  /** The built add-in, served when present. */
  addinDir?: string | undefined
  token: string
  /** Where the server's output is appended, so the Server screen's logs folder holds it. */
  logFile: string
  /** Told when the process starts and when it exits unexpectedly. */
  status: ReturnType<typeof createServerStatus>
  /** Asked after 3 exits of runs that never became stable: true when it takes over (a rollback). */
  onCrashLoop: () => boolean
}

/** Restart delays after consecutive crashes. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

/** Exits of unstable runs in a row that make a crash loop (odd/tasks/update-engine.md S3). */
const CRASH_LOOP_EXITS = 3

/**
 * Runs the backend in its own utility process and restarts it if it crashes. Nothing runs until `startFrom`
 * names the entry to fork; the arguments and environment are the same for every entry, so older servers start.
 */
export function createBackend({
  certificatesDir,
  database,
  piDir,
  port,
  token,
  addinDir,
  logFile,
  status,
  onCrashLoop
}: BackendOptions): Supervisor & Pick<ServerBackend, 'startFrom'> {
  mkdirSync(dirname(logFile), { recursive: true })
  const log = createWriteStream(logFile, { flags: 'a' })
  let entry = BUILT_IN_ENTRY
  const supervisor = createSupervisor({
    spawn: () => {
      const child = utilityProcess.fork(
        entry,
        [
          `--certs=${certificatesDir}`,
          `--db=${database}`,
          `--pi=${piDir}`,
          `--port=${port}`,
          ...(addinDir ? [`--addin=${addinDir}`] : [])
        ],
        {
          serviceName: 'stylistic-backend',
          stdio: 'pipe',
          env: { ...process.env, STYLISTIC_HUB_TOKEN: token }
        }
      )
      // Kept on the console too, for development.
      child.stdout?.on('data', (chunk: Buffer) => (log.write(chunk), process.stdout.write(chunk)))
      child.stderr?.on('data', (chunk: Buffer) => (log.write(chunk), process.stderr.write(chunk)))
      status.started()
      return child
    },
    backoffMs: BACKOFF_MS,
    crashLoop: { exits: CRASH_LOOP_EXITS, onCrashLoop },
    onExit: (exit) => {
      const line = `backend exited with code ${exit.code}; restarting in ${exit.restartInMs} ms`
      console.warn(line)
      log.write(`${new Date().toISOString()} ${line}\n`)
      status.exited(exit)
    }
  })
  return {
    ...supervisor,
    async startFrom(next) {
      entry = next
      await supervisor.halt()
      supervisor.start()
    }
  }
}
