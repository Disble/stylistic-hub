import { ipcMain } from 'electron'
import type { createWordIntegration } from './word-integration'

/** Serves the Word screen: status, connect and disconnect. */
export function registerWordIpc(word: ReturnType<typeof createWordIntegration>): void {
  ipcMain.handle('hub:word:status', () => word.status())
  ipcMain.handle('hub:word:connect', () => word.connect())
  ipcMain.handle('hub:word:disconnect', () => word.disconnect())
}
