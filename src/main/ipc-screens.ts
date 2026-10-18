import { mkdir } from 'node:fs/promises'
import { ipcMain, shell } from 'electron'
import type { createServerStatus } from './server-status'
import type { Supervisor } from './supervisor'
import type { createWordIntegration } from './word-integration'

/** Serves the Server screen (status, restart, logs) and the Word screen (status, connect, disconnect). */
export function registerScreenIpc(
  server: ReturnType<typeof createServerStatus>,
  backend: Supervisor,
  logsDir: string,
  word: ReturnType<typeof createWordIntegration>,
  restartAllowed: () => boolean = () => true
): void {
  ipcMain.handle('hub:server:status', () => server.get())
  ipcMain.handle('hub:server:restart', () => {
    if (!restartAllowed()) return
    server.restartRequested()
    backend.restart()
  })
  ipcMain.handle('hub:server:open-logs', async () => {
    await mkdir(logsDir, { recursive: true })
    const failure = await shell.openPath(logsDir)
    if (failure) throw new Error(failure)
  })
  ipcMain.handle('hub:word:status', () => word.status())
  ipcMain.handle('hub:word:connect', () => word.connect())
  ipcMain.handle('hub:word:disconnect', () => word.disconnect())
}
