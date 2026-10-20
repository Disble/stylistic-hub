import { arch, release, type } from 'node:os'
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
import { createLibrary } from './library'
import { registerProviderIpc } from './ipc-provider'
import { registerScreenIpc } from './ipc-screens'
import { createPiProvider } from './pi-provider'
import { createModuleSwitch, moduleDirFlags } from './module-switch'
import { createServerStatus } from './server-status'
import { createServerSwitch, serverDirFlag } from './server-switch'
import { channelControls } from './updates/channels'
import { startUpdateChecks } from './updates/schedule'
import { startSelfUpdate } from './updates/self-update-electron'
import { createWordIntegration } from './word-integration'
import { createWordSession } from './word-session'

/**
 * The Word directory: the session loader plus its trigger document, staged by `bun scripts/stage-word.ts`
 * (run it once for development). Both stay outside the asar archive because PowerShell and Word read them
 * from real file paths. The installer carries no add-in: Word loads the downloaded module (S1).
 */
const WORD_DIR = app.isPackaged ? join(process.resourcesPath, 'word') : join(app.getAppPath(), 'out', 'word')

/**
 * Where earlier hubs kept their bundled manifest. No file is shipped there any more, but the path is still
 * passed to the Word integration so a registration an earlier hub left behind is removed, not kept (S1).
 */
const LEGACY_ADDIN_MANIFEST = app.isPackaged
  ? join(process.resourcesPath, 'addin', 'manifest.xml')
  : join(app.getAppPath(), 'resources', 'addin', 'manifest.xml')

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
      // Modules first, so a server the check also switched starts with the new modules already set.
      onChecked: (report) => {
        library.observe(report)
        mainWindow?.webContents.send('hub:library-checked')
        void moduleSwitch.refresh().then(() => serverSwitch.refresh(report))
      },
      onReport: selfUpdate.onReport
    })
    const library = createLibrary({
      engine: updates.engine,
      check: updates.check,
      hubVersion: app.getVersion()
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
        waitUntilHealthy({
          request: hubStatusRequest({ port: HUB_PORT, token, caFile: paths.caCert, leafFile: paths.leafCert })
        }),
      status
    })
    // Word gets the stable manifests of the downloaded modules only; the installer ships no add-in (S1).
    const word = createWordIntegration({
      caFile: paths.caCert,
      manifestFile: LEGACY_ADDIN_MANIFEST,
      moduleManifests: () => moduleSwitch.manifests(),
      componentsRoot: join(userData, 'components')
    })
    const wordSession = createWordSession({
      script: join(WORD_DIR, 'word-session.ps1'),
      document: join(WORD_DIR, 'Stylistic.docx'),
      parentPid: process.pid,
      logFile: join(app.getPath('logs'), 'word-session.log')
    })
    app.on('will-quit', () => wordSession.stop())
    // Invalidate old status reads when a newer read or an explicit Word action takes precedence.
    let wordSessionRevision = 0
    // While Stylistic is in Word, the hub starts with Windows and keeps loading it into every Word session.
    const keepInWord = (enabled: boolean) => {
      wordSessionRevision++
      if (enabled) wordSession.start()
      else wordSession.stop()
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, args: [BACKGROUND_FLAG] })
    }
    const restoreWordSession = () => {
      const revision = ++wordSessionRevision
      return word.status().then(
        (current) => {
          if (revision === wordSessionRevision) keepInWord(current.addinRegistered)
        },
        (error: unknown) => console.error('Could not read Word status:', error)
      )
    }
    const hubRequest = (path: string) =>
      hubStatusRequest({ port: HUB_PORT, token, caFile: paths.caCert, leafFile: paths.leafCert, path })
    const moduleSwitch = createModuleSwitch({
      engine: updates.engine,
      componentsRoot: join(userData, 'components'),
      // `--module <id>=<dir>` serves a development build of a module (unpackaged hub only).
      devModules: moduleDirFlags(process.argv, app.isPackaged),
      backend,
      restartAllowed: () => serverSwitch.restartAllowed(),
      // A module is healthy once its manifest and its task pane both answer 200 at `/m/<id>/`.
      healthy: (id) =>
        waitUntilHealthy({
          request: async () => {
            const manifest = await hubRequest(`/m/${id}/manifest.xml`)()
            return manifest === 200 ? hubRequest(`/m/${id}/taskpane.html`)() : manifest
          }
        }),
      serverHealthy: () => waitUntilHealthy({ request: hubRequest('/api/v1/status') }),
      servesModules: async () => (await hubRequest('/api/v1/modules')().catch(() => 0)) !== 404,
      // The catalog notification precedes async resolution/health. Notify again only after Word's
      // registration sync settles, so mounted screens see the module that actually became ready (B2).
      onChange: () =>
        void word
          .sync()
          .catch((error: unknown) => console.error('Could not update Stylistic in Word:', error))
          .then(restoreWordSession)
          .then(() => mainWindow?.webContents.send('hub:library-checked')),
      report: status.setReason
    })
    // The backend's first start already serves the installed modules. Word is tidied only after the served
    // modules resolved: tidying first would delete an upgrade's legacy registration before knowing the module
    // that replaces it, and a later sync adds nothing while Word holds no entry. A failing tidy still starts
    // the server.
    const modulesReady = moduleSwitch
      .start()
      .catch((error: unknown) => console.error('Could not resolve the modules:', error))
      .then(() =>
        word.sync().catch((error: unknown) => console.error('Could not tidy Stylistic in Word:', error))
      )
    // Server health/rollback must not block restoration of an already registered Word module.
    void modulesReady
      .then(() => serverSwitch.start())
      .catch((error: unknown) => console.error('Could not start the local server:', error))
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
    registerScreenIpc(
      status,
      backend,
      app.getPath('logs'),
      {
        ...word,
        connect: async () => {
          wordSessionRevision++
          await word.connect()
          keepInWord(true)
        },
        disconnect: async () => {
          wordSessionRevision++
          await word.disconnect()
          keepInWord(false)
        }
      },
      channelControls(updates.engine, updates.check),
      {
        logsDir: app.getPath('logs'),
        componentsRoot: join(userData, 'components'),
        hubVersion: app.getVersion(),
        os: `${type()} ${release()} ${arch()}`,
        versions: { electron: process.versions.electron, node: process.versions.node },
        serverStatus: status.get,
        wordStatus: word.status
      },
      library,
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

    // An unresolved module set looks unregistered. Decide only after resolution and registration sync;
    // later module readiness notifications repeat the decision without delaying the window or tray.
    void modulesReady.then(restoreWordSession)
  })

  // Closing the window leaves the hub in the tray: Word needs its server and its session loader.
  app.on('window-all-closed', () => undefined)
}
