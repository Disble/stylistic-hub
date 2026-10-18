import type { ServerStatus } from '../shared/bridge'

/**
 * Tracks the backend process from the supervisor's spawn and exit callbacks, so the Server
 * screen can show a crash loop instead of the hub failing silently.
 */
export function createServerStatus({
  version,
  address,
  onChange
}: {
  version: string
  address: string
  onChange: (status: ServerStatus) => void
}) {
  let status: ServerStatus = { state: 'starting', version, address, crashes: 0 }

  const set = (next: ServerStatus) => {
    status = next
    onChange(status)
  }

  return {
    get: (): ServerStatus => status,
    started() {
      const next: ServerStatus = { ...status, state: 'running' }
      delete next.restartInMs
      set(next)
    },
    /** The user asked for a restart: the server is starting again, which is not a crash. */
    restartRequested() {
      const next: ServerStatus = { ...status, state: 'starting' }
      delete next.restartInMs
      set(next)
    },
    exited({ code, restartInMs }: { code: number; restartInMs: number }) {
      set({ ...status, state: 'restarting', crashes: status.crashes + 1, lastExitCode: code, restartInMs })
    },
    /** The version that runs now: a server component's, or the built-in server's. */
    setVersion(version: string) {
      set({ ...status, version })
    },
    /** A server version failed and the hub went back; the reason stays visible once the earlier one runs. */
    rolledBack(reason: string) {
      const next: ServerStatus = { ...status, state: 'rolled-back', reason }
      delete next.restartInMs
      set(next)
    },
    /** Explains the state, for instance a crash loop with no earlier version to go back to. */
    setReason(reason: string) {
      set({ ...status, reason })
    }
  }
}
