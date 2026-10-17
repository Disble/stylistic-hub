import { createWriteStream, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
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
  /** Where the server's output is appended, so the Server screen's logs folder holds it. */
  logFile: string
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
  logFile,
  status
}: BackendOptions): Supervisor {
  mkdirSync(dirname(logFile), { recursive: true })
  const log = createWriteStream(logFile, { flags: 'a' })
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
    onExit: (exit) => {
      const line = `backend exited with code ${exit.code}; restarting in ${exit.restartInMs} ms`
      console.warn(line)
      log.write(`${new Date().toISOString()} ${line}\n`)
      status.exited(exit)
    }
  })
  supervisor.start()
  return supervisor
}
