/** The API the preload script exposes to the renderer as `window.hub`. */
export interface HubBridge {
  versions: {
    electron: string
    node: string
  }
}

declare global {
  interface Window {
    hub: HubBridge
  }
}
