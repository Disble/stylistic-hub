import type { LoginAuthType, LoginEvent } from './login/login'

/** A Pi provider as the Provider screen shows it. */
export interface ProviderSummary {
  id: string
  name: string
  /** True once the provider has a credential. */
  configured: boolean
  /** The sign-in methods Pi offers for this provider. */
  authMethods: { type: LoginAuthType; label: string }[]
}

/** A model of a signed-in provider. */
export interface ModelSummary {
  provider: string
  id: string
  name: string
}

/** Where Word stands with this hub. */
export interface WordStatus {
  /** The add-in is bundled with the hub and the backend has written its CA. */
  available: boolean
  caTrusted: boolean
  addinRegistered: boolean
  /** The add-in's version, from its manifest, once it is bundled. */
  version?: string
}

/** The local server process as the Server screen shows it. */
export interface ServerStatus {
  /** `restarting`: it exited unexpectedly and the hub starts it again after `restartInMs`. */
  state: 'starting' | 'running' | 'restarting'
  version: string
  /** Where the task pane and the API are served. */
  address: string
  /** Unexpected exits since the hub opened. */
  crashes: number
  lastExitCode?: number
  restartInMs?: number
}

/** The API the preload script exposes to the renderer as `window.hub`. */
export interface HubBridge {
  versions: {
    electron: string
    node: string
  }
  provider: {
    list(): Promise<ProviderSummary[]>
    listModels(): Promise<ModelSummary[]>
    getModel(): Promise<ModelSummary | undefined>
    setModel(provider: string, modelId: string): Promise<ModelSummary>
    logout(providerId: string): Promise<void>
    /** Starts a sign-in; its progress arrives through `onLoginEvent`. */
    startLogin(providerId: string, type: LoginAuthType): Promise<string>
    answerPrompt(loginId: string, promptId: string, value: string): Promise<void>
    cancelLogin(loginId: string): Promise<void>
    /** Subscribes to sign-in events; returns the unsubscribe function. */
    onLoginEvent(listener: (event: LoginEvent) => void): () => void
  }
  server: {
    status(): Promise<ServerStatus>
    /** Subscribes to status changes; returns the unsubscribe function. */
    onStatus(listener: (status: ServerStatus) => void): () => void
  }
  word: {
    status(): Promise<WordStatus>
    /** Trusts the hub certificate (Windows asks the user) and adds Stylistic to Word. */
    connect(): Promise<void>
    disconnect(): Promise<void>
  }
}

/** Types `window.hub` for the renderer. */
declare global {
  interface Window {
    hub: HubBridge
  }
}
