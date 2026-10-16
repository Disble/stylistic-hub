import { ipcMain } from 'electron'
import type { createServerStatus } from './server-status'
import type { createWordIntegration } from './word-integration'

/** Serves the Server screen's status and the Word screen (status, connect, disconnect, open). */
export function registerScreenIpc(
  server: ReturnType<typeof createServerStatus>,
  word: ReturnType<typeof createWordIntegration>,
  openWord: () => Promise<void>
): void {
  ipcMain.handle('hub:server:status', () => server.get())
  ipcMain.handle('hub:word:status', () => word.status())
  ipcMain.handle('hub:word:connect', () => word.connect())
  ipcMain.handle('hub:word:disconnect', () => word.disconnect())
  ipcMain.handle('hub:word:open', () => openWord())
}
