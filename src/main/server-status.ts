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
    exited({ code, restartInMs }: { code: number; restartInMs: number }) {
      set({ ...status, state: 'restarting', crashes: status.crashes + 1, lastExitCode: code, restartInMs })
    }
  }
}
