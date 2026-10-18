import { mkdir } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { exportDiagnostics, type DiagnosticsSources } from './diagnostics'
import type { createServerStatus } from './server-status'
import type { Supervisor } from './supervisor'
import type { channelControls } from './updates/channels'
import type { createWordIntegration } from './word-integration'

/** The save dialog's title: Windows shows no message in it, so the title says what the bundle holds. */
const DIAGNOSTICS_TITLE =
  "Export diagnostics (includes the hub's logs, which may hold excerpts of analyzed text)"

/** Serves the Server screen (status, restart, logs, channels, diagnostics) and the Word screen (status, connect, disconnect). */
export function registerScreenIpc(
  server: ReturnType<typeof createServerStatus>,
  backend: Supervisor,
  logsDir: string,
  word: ReturnType<typeof createWordIntegration>,
  channels: ReturnType<typeof channelControls>,
  diagnostics: DiagnosticsSources,
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
  ipcMain.handle('hub:server:channels', () => channels.get())
  ipcMain.handle('hub:server:set-channel', (_event, target: string, channel: string) =>
    channels.set(target, channel)
  )
  ipcMain.handle('hub:server:export-diagnostics', (event) =>
    exportDiagnostics({
      ...diagnostics,
      choosePath: async () => {
        const options = {
          title: DIAGNOSTICS_TITLE,
          defaultPath: 'stylistic-diagnostics.zip',
          filters: [{ name: 'Zip', extensions: ['zip'] }]
        }
        const window = BrowserWindow.fromWebContents(event.sender)
        const result = await (window
          ? dialog.showSaveDialog(window, options)
          : dialog.showSaveDialog(options))
        return result.canceled ? undefined : result.filePath
      }
    })
  )
  ipcMain.handle('hub:word:status', () => word.status())
  ipcMain.handle('hub:word:connect', () => word.connect())
  ipcMain.handle('hub:word:disconnect', () => word.disconnect())
}
