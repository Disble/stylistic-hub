import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { HUB_PORT } from '../shared/versions'
import { startBackend } from './backend-host'
import { hubPaths } from './hub-paths'
import { loadOrCreateHubToken } from './hub-token'

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

  // External links open in the default browser, never inside the hub window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
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

  void app.whenReady().then(() => {
    const paths = hubPaths(app.getPath('userData'))
    const backend = startBackend({
      certificatesDir: paths.certificates,
      port: HUB_PORT,
      token: loadOrCreateHubToken(paths.token)
    })
    app.on('will-quit', () => backend.stop())
    mainWindow = createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
