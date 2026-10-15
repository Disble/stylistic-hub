import { contextBridge } from 'electron'
import type { HubBridge } from '../shared/bridge'

/** The renderer-facing API, exposed as `window.hub`. */
const bridge: HubBridge = {
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node
  }
}

contextBridge.exposeInMainWorld('hub', bridge)
