import { useCallback, useEffect, useState } from 'react'
import type { ServerStatus, WordStatus } from '../shared/bridge'

/** The hub's screens, in navigation order. */
export type Screen = 'home' | 'word' | 'server' | 'provider'

/** The local server's status, kept current by the main process's notifications. */
export function useServerStatus(): ServerStatus | undefined {
  const [status, setStatus] = useState<ServerStatus | undefined>()

  useEffect(() => {
    let live = true
    void window.hub.server.status().then((current) => live && setStatus(current))
    const unsubscribe = window.hub.server.onStatus(setStatus)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  return status
}

/** Word's status with this hub, read again whenever `refresh` is called. */
export function useWordStatus(): { status: WordStatus | undefined; refresh: () => void } {
  const [status, setStatus] = useState<WordStatus | undefined>()
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let live = true
    void window.hub.word.status().then((current) => live && setStatus(current))
    return () => {
      live = false
    }
  }, [reloads])

  return { status, refresh: useCallback(() => setReloads((n) => n + 1), []) }
}

/** True once Windows trusts the hub certificate and Word lists the add-in. */
export function wordReady(status: WordStatus | undefined): boolean {
  return Boolean(status?.caTrusted && status.addinRegistered)
}

/** The message to show for a rejected action. */
export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
