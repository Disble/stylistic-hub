import type { HubBridge, ServerStatus } from '../shared/bridge'

/** A running server, as most screen tests need it. */
export const RUNNING: ServerStatus = {
  state: 'running',
  version: '0.0.1',
  address: 'https://localhost:3000',
  crashes: 0
}

/** A `window.hub` for renderer tests: every call answers with an empty, healthy hub unless overridden. */
export function fakeHub(overrides: { [K in keyof HubBridge]?: Partial<HubBridge[K]> } = {}): HubBridge {
  return {
    versions: { electron: '44.7.2', node: '24.21.0', ...overrides.versions },
    provider: {
      list: async () => [],
      listModels: async () => [],
      getModel: async () => undefined,
      setModel: async () => ({ provider: '', id: '', name: '' }),
      logout: async () => undefined,
      startLogin: async () => '',
      answerPrompt: async () => undefined,
      cancelLogin: async () => undefined,
      onLoginEvent: () => () => undefined,
      ...overrides.provider
    },
    server: { status: async () => RUNNING, onStatus: () => () => undefined, ...overrides.server },
    word: {
      status: async () => ({ available: true, caTrusted: false, addinRegistered: false, version: '1.0.0.0' }),
      connect: async () => undefined,
      disconnect: async () => undefined,
      ...overrides.word
    }
  }
}
