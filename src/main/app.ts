import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { safeExternalUrl } from '../shared/login/external-link'
import { HUB_PORT, SERVER_VERSION } from '../shared/versions'
import { startBackend } from './backend-host'
import { hubPaths } from './hub-paths'
import { loadOrCreateHubToken } from './hub-token'
import { registerProviderIpc } from './ipc-provider'
import { registerScreenIpc } from './ipc-screens'
import { createPiProvider } from './pi-provider'
import { createServerStatus } from './server-status'
import { createWordIntegration } from './word-integration'

/**
 * stylistic-addon's build. It ships outside the asar archive because Word reads the manifest from a
 * real file path; in development `bun run addin:bundle` copies it into `resources/addin`.
 */
const ADDIN_DIR = app.isPackaged
  ? join(process.resourcesPath, 'addin')
  : join(app.getAppPath(), 'resources', 'addin')

/** False when another hub is already running for this Windows user; this one then quits. */
const isSingleInstance = app.requestSingleInstanceLock()

/** Opens the hub window with an isolated, sandboxed renderer. */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Stylistic Hub',
    backgroundColor: '#f1efed',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // External links open in the default browser, never inside the hub window, and only http(s):
  // sign-in pages come from providers, so a `file:` or custom-scheme link is never opened.
  window.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url)
    if (safe) void shell.openExternal(safe)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

if (!isSingleInstance) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | undefined

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    const paths = hubPaths(app.getPath('userData'))
    const status = createServerStatus({
      version: SERVER_VERSION,
      address: `https://localhost:${HUB_PORT}`,
      onChange: (current) => mainWindow?.webContents.send('hub:server-status', current)
    })
    const backend = startBackend({
      status,
      certificatesDir: paths.certificates,
      database: paths.database,
      piDir: paths.piDir,
      port: HUB_PORT,
      addinDir: existsSync(ADDIN_DIR) ? ADDIN_DIR : undefined,
      token: loadOrCreateHubToken(paths.token)
    })
    app.on('will-quit', () => backend.stop())
    registerProviderIpc(await createPiProvider(paths.piDir), () => mainWindow?.webContents)
    registerScreenIpc(
      status,
      createWordIntegration({ caFile: paths.caCert, manifestFile: join(ADDIN_DIR, 'manifest.xml') })
    )
    mainWindow = createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
