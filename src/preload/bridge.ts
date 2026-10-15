import { contextBridge, ipcRenderer } from 'electron'
import type { HubBridge, ServerStatus } from '../shared/bridge'
import type { LoginEvent } from '../shared/login/login'

/** The renderer-facing API, exposed as `window.hub`. */
const bridge: HubBridge = {
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node
  },
  provider: {
    list: () => ipcRenderer.invoke('hub:provider:list'),
    listModels: () => ipcRenderer.invoke('hub:provider:list-models'),
    getModel: () => ipcRenderer.invoke('hub:provider:get-model'),
    setModel: (provider, modelId) => ipcRenderer.invoke('hub:provider:set-model', provider, modelId),
    logout: (providerId) => ipcRenderer.invoke('hub:provider:logout', providerId),
    startLogin: (providerId, type) => ipcRenderer.invoke('hub:login:start', providerId, type),
    answerPrompt: (loginId, promptId, value) =>
      ipcRenderer.invoke('hub:login:answer', loginId, promptId, value),
    cancelLogin: (loginId) => ipcRenderer.invoke('hub:login:cancel', loginId),
    onLoginEvent: (listener) => {
      const handler = (_event: unknown, event: LoginEvent) => listener(event)
      ipcRenderer.on('hub:login-event', handler)
      return () => void ipcRenderer.removeListener('hub:login-event', handler)
    }
  },
  server: {
    status: () => ipcRenderer.invoke('hub:server:status'),
    onStatus: (listener) => {
      const handler = (_event: unknown, status: ServerStatus) => listener(status)
      ipcRenderer.on('hub:server-status', handler)
      return () => void ipcRenderer.removeListener('hub:server-status', handler)
    }
  },
  word: {
    status: () => ipcRenderer.invoke('hub:word:status'),
    connect: () => ipcRenderer.invoke('hub:word:connect'),
    disconnect: () => ipcRenderer.invoke('hub:word:disconnect')
  }
}

contextBridge.exposeInMainWorld('hub', bridge)
