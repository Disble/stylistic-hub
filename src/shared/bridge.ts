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
}

/** Types `window.hub` for the renderer. */
declare global {
  interface Window {
    hub: HubBridge
  }
}
