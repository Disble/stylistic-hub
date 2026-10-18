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

/** A local, OpenAI-compatible model server and the models it lists. */
export interface LocalModel {
  baseUrl: string
  models: string[]
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
  /**
   * `restarting`: it exited unexpectedly and the hub starts it again after `restartInMs`. `rolled-back`: a
   * server version failed its health check or kept crashing, and the hub went back (or stopped); see `reason`.
   */
  state: 'starting' | 'running' | 'restarting' | 'rolled-back'
  version: string
  /** Where the task pane and the API are served. */
  address: string
  /** Unexpected exits since the hub opened. */
  crashes: number
  lastExitCode?: number
  restartInMs?: number
  /** Why the hub rolled back or stopped the server, kept for as long as the hub runs. */
  reason?: string
}

/** A release stream: `stable`, or `beta` prereleases. */
export type Channel = 'stable' | 'beta'

/** The channels the Server screen chooses: the server's and the hub's own. */
export interface Channels {
  server: Channel
  hub: Channel
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
    /** The local model server Pi uses, if one is connected. */
    getLocal(): Promise<LocalModel | undefined>
    /** Lists the server's models and adds them to Pi; rejects with the reason it cannot. */
    connectLocal(baseUrl: string): Promise<LocalModel>
    disconnectLocal(): Promise<void>
    /** Starts a sign-in; its progress arrives through `onLoginEvent`. */
    startLogin(providerId: string, type: LoginAuthType): Promise<string>
    answerPrompt(loginId: string, promptId: string, value: string): Promise<void>
    cancelLogin(loginId: string): Promise<void>
    /** Subscribes to sign-in events; returns the unsubscribe function. */
    onLoginEvent(listener: (event: LoginEvent) => void): () => void
  }
  server: {
    status(): Promise<ServerStatus>
    /** Stops the server and starts it again; not counted as a crash. */
    restart(): Promise<void>
    /** Opens the hub's logs folder in Explorer. */
    openLogs(): Promise<void>
    /** Subscribes to status changes; returns the unsubscribe function. */
    onStatus(listener: (status: ServerStatus) => void): () => void
    channels(): Promise<Channels>
    /** Sets the channel of the server or the hub, then runs a catalog check. */
    setChannel(target: keyof Channels, channel: Channel): Promise<void>
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
