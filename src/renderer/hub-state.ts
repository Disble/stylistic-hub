import { useCallback, useEffect, useState } from 'react'
import type {
  Library,
  LibraryComponent,
  ModelSummary,
  ProviderSummary,
  ServerStatus,
  WordStatus,
  WORD_MODULE_ID as SharedWordModuleId
} from '../shared/bridge'

/** The bridge pins this literal at compile time; renderer dependencies on shared stay type-only. */
export const WORD_MODULE_ID: typeof SharedWordModuleId = 'stylistic-word-addin'

/** The hub's screens, in navigation order. */
export type Screen = 'home' | 'word' | 'server' | 'provider' | 'library'

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

/** Word's status with this hub, read again whenever `refresh` is called and after each catalog check. */
export function useWordStatus(): { status: WordStatus | undefined; refresh: () => void } {
  const [status, setStatus] = useState<WordStatus | undefined>()
  const [reloads, setReloads] = useState(0)
  const refresh = useCallback(() => setReloads((n) => n + 1), [])

  useEffect(() => {
    let live = true
    void window.hub.word
      .status()
      .then((current) => live && setStatus(current))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [reloads])
  // A completed check can download the module Word was waiting for, so a mounted screen follows it.
  useEffect(() => window.hub.library.onChecked(refresh), [refresh])

  return { status, refresh }
}

/** The signed-in providers and the model the corrections use. */
export interface ProviderState {
  connected: ProviderSummary[]
  model: ModelSummary | undefined
}

/** Reads which providers are signed in and the chosen model, once per mount. */
export function useProviderState(): ProviderState | undefined {
  const [state, setState] = useState<ProviderState | undefined>()

  useEffect(() => {
    let live = true
    void Promise.all([window.hub.provider.list(), window.hub.provider.getModel()]).then(
      ([providers, model]) => live && setState({ connected: providers.filter((p) => p.configured), model })
    )
    return () => {
      live = false
    }
  }, [])

  return state
}

/** True once a provider is signed in and a model is chosen: the workflows refuse to run without one. */
export function providerReady(state: ProviderState | undefined): boolean {
  return Boolean(state?.connected.length && state.model)
}

/** True once Windows trusts the hub certificate and Word lists the add-in. */
export function wordReady(status: WordStatus | undefined): boolean {
  return Boolean(status?.caTrusted && status.addinRegistered)
}

/** The Library, read again after each catalog check and whenever `refresh` is called. */
export function useLibrary(): { library: Library | undefined; refresh: () => void } {
  const [library, setLibrary] = useState<Library | undefined>()
  const [reloads, setReloads] = useState(0)
  const refresh = useCallback(() => setReloads((n) => n + 1), [])

  useEffect(() => {
    let live = true
    void window.hub.library
      .list()
      .then((current) => live && setLibrary(current))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [reloads])
  useEffect(() => window.hub.library.onChecked(refresh), [refresh])

  return { library, refresh }
}

/** The Word module in the Library, if the last catalog check listed it. */
export function wordModule(library: Library | undefined): LibraryComponent | undefined {
  return library?.components.find((component) => component.id === WORD_MODULE_ID)
}

/** The message to show for a rejected action. */
export function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
