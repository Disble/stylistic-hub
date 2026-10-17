import { randomUUID } from 'node:crypto'
import { ipcMain, shell, type WebContents } from 'electron'
import type { LoginAuthType } from '../shared/login/login'
import { authUrlToOpen, createLoginManager } from '../shared/login/login'
import type { createLocalModel } from './local-model'
import type { PiProvider } from './pi-provider'

/** A sign-in that stays silent this long is abandoned (device codes stretch it to their own lifetime). */
const STALE_MS = 10 * 60_000

/** Serves the Provider screen: Pi sign-ins, sign-outs, the local model and the model choice. */
export function registerProviderIpc(
  provider: PiProvider,
  local: ReturnType<typeof createLocalModel>,
  getContents: () => WebContents | undefined
): void {
  const logins = createLoginManager({
    run: (providerId, type, interaction) => provider.login(providerId, type, interaction),
    emit: (event) => {
      // The provider's sign-in page opens in the system browser, never inside the hub.
      const url = authUrlToOpen(event)
      if (url) void shell.openExternal(url)
      getContents()?.send('hub:login-event', event)
    },
    schedule: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
    newId: randomUUID,
    staleMs: STALE_MS
  })

  ipcMain.handle('hub:provider:list', () => provider.listProviders())
  ipcMain.handle('hub:provider:list-models', () => provider.listModels())
  ipcMain.handle('hub:provider:get-model', () => provider.getModel())
  ipcMain.handle('hub:provider:set-model', (_e, providerId: string, modelId: string) =>
    provider.setModel(providerId, modelId)
  )
  ipcMain.handle('hub:provider:logout', (_e, providerId: string) => provider.logout(providerId))
  ipcMain.handle('hub:provider:get-local', () => local.get())
  ipcMain.handle('hub:provider:connect-local', async (_e, baseUrl: string) => {
    const connected = await local.connect(baseUrl)
    await provider.reload()
    return connected
  })
  ipcMain.handle('hub:provider:disconnect-local', async () => {
    await local.disconnect()
    await provider.reload()
  })
  ipcMain.handle('hub:login:start', (_e, providerId: string, type: LoginAuthType) =>
    logins.start(providerId, type)
  )
  ipcMain.handle('hub:login:answer', (_e, loginId: string, promptId: string, value: string) =>
    logins.answerPrompt(loginId, promptId, value)
  )
  ipcMain.handle('hub:login:cancel', (_e, loginId: string) => logins.cancelLogin(loginId))
}
