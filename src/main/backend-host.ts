import { utilityProcess } from 'electron'
// fallow-ignore-next-line boundary-violation -- build-time bundle path for utilityProcess.fork, not a code import
import backendPath from '../backend/entry?modulePath'
import { createSupervisor, type Supervisor } from './supervisor'

/** What the backend process needs to start. */
export interface BackendOptions {
  certificatesDir: string
  port: number
  token: string
}

/** Restart delays after consecutive crashes. */
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]

/** Runs the backend in its own utility process and restarts it if it crashes. */
export function startBackend({ certificatesDir, port, token }: BackendOptions): Supervisor {
  const supervisor = createSupervisor({
    spawn: () =>
      utilityProcess.fork(backendPath, [`--certs=${certificatesDir}`, `--port=${port}`], {
        serviceName: 'stylistic-backend',
        stdio: 'inherit',
        env: { ...process.env, STYLISTIC_HUB_TOKEN: token }
      }),
    backoffMs: BACKOFF_MS,
    onExit: ({ code, restartInMs }) =>
      console.warn(`backend exited with code ${code}; restarting in ${restartInMs} ms`)
  })
  supervisor.start()
  return supervisor
}
