import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from 'electron'
import { safeExternalUrl } from '../shared/login/external-link'
import { HUB_PORT, SERVER_VERSION } from '../shared/versions'
import { BUILT_IN_ENTRY, createBackend } from './backend-host'
import { waitUntilHealthy } from './health-check'
import { hubStatusRequest } from './health-request'
import { hubPaths } from './hub-paths'
import { createLocalModel } from './local-model'
import { loadOrCreateHubToken } from './hub-token'
import { registerProviderIpc } from './ipc-provider'
import { registerScreenIpc } from './ipc-screens'
import { createPiProvider } from './pi-provider'
import { createServerStatus } from './server-status'
import { createServerSwitch, serverDirFlag } from './server-switch'
import { channelControls } from './updates/channels'
import { startUpdateChecks } from './updates/schedule'
import { startSelfUpdate } from './updates/self-update-electron'
import { createWordIntegration } from './word-integration'
import { createWordSession } from './word-session'

/**
 * stylistic-addon's build. It ships outside the asar archive because Word reads the manifest from a
 * real file path; in development `bun run addin:bundle` copies it into `resources/addin`.
 */
const ADDIN_DIR = app.isPackaged
  ? join(process.resourcesPath, 'addin')
  : join(app.getAppPath(), 'resources', 'addin')

/** `word-session.ps1`, also outside the asar archive because PowerShell runs it from a real path. */
const WORD_DIR = app.isPackaged
  ? join(process.resourcesPath, 'word')
  : join(app.getAppPath(), 'resources', 'word')

/** Windows starts the hub with this flag at sign-in; it then runs in the tray without opening a window. */
const BACKGROUND_FLAG = '--background'

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
  /** Kept referenced so the tray icon is not garbage-collected. */
  let tray: Tray | undefined

  const showWindow = () => {
    if (!mainWindow) {
      const window = createWindow()
      // The hub outlives its window, so nothing may send to a closed one.
      window.on('closed', () => {
        if (mainWindow === window) mainWindow = undefined
      })
      mainWindow = window
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }

  app.on('second-instance', showWindow)

  void app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    const paths = hubPaths(userData)
    const token = loadOrCreateHubToken(paths.token)
    const status = createServerStatus({
      version: SERVER_VERSION,
      address: `https://localhost:${HUB_PORT}`,
      onChange: (current) => mainWindow?.webContents.send('hub:server-status', current)
    })
    const backend = createBackend({
      status,
      certificatesDir: paths.certificates,
      database: paths.database,
      piDir: paths.piDir,
      port: HUB_PORT,
      addinDir: existsSync(ADDIN_DIR) ? ADDIN_DIR : undefined,
      token,
      logFile: join(app.getPath('logs'), 'server.log'),
      // Both callbacks run only after the switch below exists: the first spawn and the first check end later.
      onCrashLoop: () => serverSwitch.crashLoop()
    })
    // Node's global fetch, as for the local model: the catalog and components are public HTTPS files whose
    // signatures the engine verifies, and it is the fetch type the engine is written and tested against.
    // The hub's own update (D10): after each check, a newer verified installer is handed to electron-updater.
    const selfUpdate = startSelfUpdate({ userData, currentVersion: app.getVersion() })
    const updates = startUpdateChecks({
      userData,
      database: paths.database,
      fetch,
      onChecked: (report) => void serverSwitch.refresh(report),
      onReport: selfUpdate.onReport
    })
    const serverSwitch = createServerSwitch({
      engine: updates.engine,
      componentsRoot: join(userData, 'components'),
      database: paths.database,
      builtIn: { entry: BUILT_IN_ENTRY, version: SERVER_VERSION },
      // `--server <dir>` runs a development build of the server (unpackaged hub only).
      devServerDir: serverDirFlag(process.argv, app.isPackaged),
      backend,
      healthy: () =>
        waitUntilHealthy({ request: hubStatusRequest({ port: HUB_PORT, token, caFile: paths.caCert }) }),
      status
    })
    void serverSwitch.start()
    app.on('will-quit', () => {
      updates.stop()
      selfUpdate.stop()
      backend.stop()
    })
    registerProviderIpc(
      await createPiProvider(paths.piDir),
      createLocalModel({ modelsFile: join(paths.piDir, 'models.json'), fetch }),
      () => mainWindow?.webContents
    )
    const word = createWordIntegration({
      caFile: paths.caCert,
      manifestFile: join(ADDIN_DIR, 'manifest.xml')
    })
    const wordSession = createWordSession({
      script: join(WORD_DIR, 'word-session.ps1'),
      document: join(ADDIN_DIR, 'Stylistic.docx'),
      parentPid: process.pid,
      logFile: join(app.getPath('logs'), 'word-session.log')
    })
    app.on('will-quit', () => wordSession.stop())
    // While Stylistic is in Word, the hub starts with Windows and keeps loading it into every Word session.
    const keepInWord = (enabled: boolean) => {
      if (enabled) wordSession.start()
      else wordSession.stop()
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, args: [BACKGROUND_FLAG] })
    }
    registerScreenIpc(
      status,
      backend,
      app.getPath('logs'),
      {
        ...word,
        connect: async () => {
          await word.connect()
          keepInWord(true)
        },
        disconnect: async () => {
          await word.disconnect()
          keepInWord(false)
        }
      },
      channelControls(updates.engine, updates.check),
      serverSwitch.restartAllowed
    )

    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png'))
    tray = new Tray(icon.resize({ width: 16, height: 16 }))
    tray.setToolTip('Stylistic Hub')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Stylistic Hub', click: showWindow },
        { type: 'separator' },
        { label: 'Quit Stylistic Hub', click: () => app.quit() }
      ])
    )
    tray.on('click', showWindow)

    if (!process.argv.includes(BACKGROUND_FLAG)) showWindow()
    app.on('activate', showWindow)

    // Follows Word's actual state, also when Stylistic was removed outside the hub. A failure here must not
    // leave the hub without its window and tray, which already exist.
    word.status().then(
      (current) => keepInWord(current.addinRegistered),
      (error: unknown) => console.error('Could not read Word status:', error)
    )
  })

  // Closing the window leaves the hub in the tray: Word needs its server and its session loader.
  app.on('window-all-closed', () => undefined)
}
