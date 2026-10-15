/** The API the preload script exposes to the renderer as `window.hub`. */
export interface HubBridge {
  versions: {
    electron: string
    node: string
  }
}

/** Types `window.hub` for the renderer. */
declare global {
  interface Window {
    hub: HubBridge
  }
}
