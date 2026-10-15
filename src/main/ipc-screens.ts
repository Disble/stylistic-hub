import { ipcMain, type WebContents } from 'electron'
import type { createServerStatus } from './server-status'
import type { createWordIntegration } from './word-integration'

/** Serves the Server screen (status and its changes) and the Word screen (status, connect, disconnect). */
export function registerScreenIpc(
  server: ReturnType<typeof createServerStatus>,
  word: ReturnType<typeof createWordIntegration>,
  getContents: () => WebContents | undefined
): void {
  ipcMain.handle('hub:server:status', () => server.get())
  server.subscribe((status) => getContents()?.send('hub:server-status', status))
  ipcMain.handle('hub:word:status', () => word.status())
  ipcMain.handle('hub:word:connect', () => word.connect())
  ipcMain.handle('hub:word:disconnect', () => word.disconnect())
}
