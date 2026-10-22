// Exercise the Electron startup boundary without launching Word, processes, or real registry commands.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Isolated desktop ports with an explicitly delayed installed-module resolution. */
const hub = vi.hoisted(() => {
  let releaseModules: () => void = () => undefined
  let modulesReady = false
  const word = {
    status: vi.fn(async () => ({ available: modulesReady, addinRegistered: modulesReady })),
    sync: vi.fn<() => Promise<void>>(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined)
  }
  const session = { start: vi.fn(), stop: vi.fn() }
  const backend = { stop: vi.fn() }
  const registerScreens = vi.fn()
  const createModules = vi.fn()
  const createServer = vi.fn()
  const login = vi.fn()
  return {
    word,
    session,
    backend,
    registerScreens,
    createModules,
    createServer,
    login,
    release: () => releaseModules(),
    reset() {
      modulesReady = false
      const ready = new Promise<void>((resolve) => {
        releaseModules = () => {
          modulesReady = true
          resolve()
        }
      })
      createModules.mockReturnValue({ start: () => ready, manifests: () => [], refresh: vi.fn() })
      createServer.mockReturnValue({
        start: vi.fn(async () => undefined),
        restartAllowed: () => true
      })
      word.status.mockImplementation(async () => ({
        available: modulesReady,
        addinRegistered: modulesReady
      }))
    }
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    requestSingleInstanceLock: () => true,
    whenReady: async () => undefined,
    getPath: () => 'isolated-hub',
    getVersion: () => '1.1.0',
    getAppPath: () => 'isolated-app',
    on: vi.fn(),
    setLoginItemSettings: hub.login
  },
  BrowserWindow: class {
    webContents = { send: vi.fn(), setWindowOpenHandler: vi.fn() }
    once = vi.fn()
    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
  },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: { createFromPath: () => ({ resize: vi.fn() }) },
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    on = vi.fn()
  },
  shell: {}
}))
vi.mock('./hub-token', () => ({ loadOrCreateHubToken: () => 'isolated-token' }))
vi.mock('./backend-host', () => ({ BUILT_IN_ENTRY: 'entry.js', createBackend: () => hub.backend }))
vi.mock('./server-status', () => ({ createServerStatus: () => ({ setReason: vi.fn() }) }))
vi.mock('./server-switch', () => ({ createServerSwitch: hub.createServer, serverDirFlag: vi.fn() }))
vi.mock('./module-switch', () => ({ createModuleSwitch: hub.createModules, moduleDirFlags: () => ({}) }))
vi.mock('./word-integration', () => ({ createWordIntegration: () => hub.word }))
vi.mock('./word-session', () => ({ createWordSession: () => hub.session }))
vi.mock('./pi-provider', () => ({ createPiProvider: async () => ({}) }))
vi.mock('./local-model', () => ({ createLocalModel: () => ({}) }))
vi.mock('./ipc-provider', () => ({ registerProviderIpc: vi.fn() }))
vi.mock('./ipc-screens', () => ({ registerScreenIpc: hub.registerScreens }))
vi.mock('./library', () => ({ createLibrary: () => ({}) }))
vi.mock('./updates/channels', () => ({ channelControls: () => ({}) }))
vi.mock('./updates/schedule', () => ({ startUpdateChecks: () => ({ engine: {}, check: vi.fn() }) }))
vi.mock('./updates/self-update-electron', () => ({ startSelfUpdate: () => ({ status: () => undefined }) }))

/** Drain the bounded startup promise chain, without timing sleeps or touching live application state. */
async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

/** Import the real main-process wiring with every external side effect mocked. */
async function boot() {
  await import('./app')
  await settle()
}

/** Deliver the module switch's public readiness notification. */
function moduleChanged(): void {
  const options = hub.createModules.mock.calls[0]?.[0] as { onChange: () => void }
  options.onChange()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  hub.reset()
  vi.stubGlobal('process', { ...process, resourcesPath: 'isolated-resources' })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Word loader lifecycle', () => {
  it('waits for module resolution before deciding loader and Windows startup state', async () => {
    await boot()

    expect(hub.word.status).not.toHaveBeenCalled()
    expect(hub.session.start).not.toHaveBeenCalled()
    expect(hub.session.stop).not.toHaveBeenCalled()
    expect(hub.login).not.toHaveBeenCalled()

    hub.release()
    await settle()

    expect(hub.word.sync).toHaveBeenCalledOnce()
    expect(hub.word.status).toHaveBeenCalledOnce()
    expect(hub.session.start).toHaveBeenCalledOnce()
    expect(hub.session.stop).not.toHaveBeenCalled()
    expect(hub.login).toHaveBeenCalledExactlyOnceWith({
      openAtLogin: true,
      args: ['--background']
    })
  })

  it.each(['pending', 'rejected'])('restores the loader even when server startup is %s', async (state) => {
    const error = new Error('server unavailable')
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await boot()
    const server = hub.createServer.mock.results[0]?.value as {
      start: ReturnType<typeof vi.fn<() => Promise<void>>>
    }
    server.start.mockImplementation(() =>
      state === 'rejected' ? Promise.reject(error) : new Promise<void>(() => undefined)
    )
    hub.release()
    await settle()

    expect(hub.session.start).toHaveBeenCalledOnce()
    expect(hub.session.stop).not.toHaveBeenCalled()
    expect(hub.login).toHaveBeenCalledExactlyOnceWith({ openAtLogin: true, args: ['--background'] })
    if (state === 'rejected') expect(log).toHaveBeenCalledWith('Could not start the local server:', error)
    else expect(log).not.toHaveBeenCalled()
  })

  it('rechecks the loader after a later module becomes ready', async () => {
    hub.word.status.mockResolvedValue({ available: false, addinRegistered: false })
    await boot()
    hub.release()
    await settle()
    expect(hub.session.start).not.toHaveBeenCalled()

    hub.word.status.mockResolvedValue({ available: true, addinRegistered: true })
    let finishSync: () => void = () => undefined
    hub.word.sync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSync = resolve
        })
    )
    moduleChanged()
    await settle()
    expect(hub.session.start).not.toHaveBeenCalled()
    finishSync()
    await settle()

    expect(hub.word.status).toHaveBeenCalledTimes(2)
    expect(hub.session.start).toHaveBeenCalledOnce()
    expect(hub.login).toHaveBeenLastCalledWith({ openAtLogin: true, args: ['--background'] })
  })

  it.each([
    { action: 'connect' as const, registered: false, enabled: true },
    { action: 'disconnect' as const, registered: true, enabled: false }
  ])('does not let an older status result undo explicit $action', async ({ action, registered, enabled }) => {
    await boot()
    hub.release()
    await settle()
    hub.session.start.mockClear()
    hub.session.stop.mockClear()
    hub.login.mockClear()

    let finishStatus: (value: { available: boolean; addinRegistered: boolean }) => void = () => undefined
    hub.word.status.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStatus = resolve
        })
    )
    moduleChanged()
    await settle()
    expect(hub.word.status).toHaveBeenCalledTimes(2)

    const word = hub.registerScreens.mock.calls[0]?.[3] as typeof hub.word
    await word[action]()
    finishStatus({ available: true, addinRegistered: registered })
    await settle()

    expect(hub.session.start).toHaveBeenCalledTimes(enabled ? 1 : 0)
    expect(hub.session.stop).toHaveBeenCalledTimes(enabled ? 0 : 1)
    expect(hub.login).toHaveBeenCalledExactlyOnceWith({
      openAtLogin: enabled,
      args: ['--background']
    })
  })

  it('keeps an unregistered add-in disabled and preserves explicit connect and disconnect', async () => {
    hub.word.status.mockResolvedValue({ available: true, addinRegistered: false })
    await boot()
    hub.release()
    await settle()

    expect(hub.session.start).not.toHaveBeenCalled()
    expect(hub.session.stop).toHaveBeenCalledOnce()
    expect(hub.login).toHaveBeenLastCalledWith({ openAtLogin: false, args: ['--background'] })
    const word = hub.registerScreens.mock.calls[0]?.[3] as typeof hub.word
    await word.connect()
    expect(hub.word.connect).toHaveBeenCalledOnce()
    expect(hub.session.start).toHaveBeenCalledOnce()
    expect(hub.login).toHaveBeenLastCalledWith({ openAtLogin: true, args: ['--background'] })
    await word.disconnect()
    expect(hub.word.disconnect).toHaveBeenCalledOnce()
    expect(hub.session.stop).toHaveBeenCalledTimes(2)
    expect(hub.login).toHaveBeenLastCalledWith({ openAtLogin: false, args: ['--background'] })
  })
})
