import { contextBridge } from 'electron'
import type { HubBridge } from './bridge'

const bridge: HubBridge = {
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node
  }
}

contextBridge.exposeInMainWorld('hub', bridge)
