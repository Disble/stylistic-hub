import { utilityProcess } from 'electron'
// fallow-ignore-next-line boundary-violation -- build-time bundle path for utilityProcess.fork, not a code import
import backendPath from '../backend/entry?modulePath'
import type { createServerStatus } from './server-status'
import { createSupervisor, type Supervisor } from './supervisor'

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
  /** Told when the process starts and when it exits unexpectedly. */
  status: ReturnType<typeof createServerStatus>
}

/** Restart delays after consecutive crashes. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

/** Runs the backend in its own utility process and restarts it if it crashes. */
export function startBackend({
  certificatesDir,
  database,
  piDir,
  port,
  token,
  addinDir,
  status
}: BackendOptions): Supervisor {
  const supervisor = createSupervisor({
    spawn: () => {
      const child = utilityProcess.fork(
        backendPath,
        [
          `--certs=${certificatesDir}`,
          `--db=${database}`,
          `--pi=${piDir}`,
          `--port=${port}`,
          ...(addinDir ? [`--addin=${addinDir}`] : [])
        ],
        {
          serviceName: 'stylistic-backend',
          stdio: 'inherit',
          env: { ...process.env, STYLISTIC_HUB_TOKEN: token }
        }
      )
      status.started()
      return child
    },
    backoffMs: BACKOFF_MS,
    onExit: (exit) => {
      console.warn(`backend exited with code ${exit.code}; restarting in ${exit.restartInMs} ms`)
      status.exited(exit)
    }
  })
  supervisor.start()
  return supervisor
}
