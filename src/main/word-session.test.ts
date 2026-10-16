import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWordSession, spawnHidden, type SpawnLoader } from './word-session'

/** A loader process that records being killed and can be made to exit. */
class FakeLoader extends EventEmitter {
  killed = false
  kill() {
    this.killed = true
    return true
  }
}

/** Spawns fake loaders and keeps them in order. */
function loaders() {
  const spawned: FakeLoader[] = []
  const spawn = vi.fn<SpawnLoader>(() => {
    const loader = new FakeLoader()
    spawned.push(loader)
    return loader
  })
  return { spawn, spawned }
}

/** The files the loader works on. */
const files = { script: 'C:\\hub\\word\\word-session.ps1', document: 'C:\\hub\\addin\\Stylistic.docx' }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createWordSession', () => {
  it('runs the loader script hidden in PowerShell for the bundled document and this hub', () => {
    const { spawn } = loaders()

    createWordSession({ ...files, spawn, parentPid: 4242 }).start()

    expect(spawn).toHaveBeenCalledWith('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      files.script,
      '-Document',
      files.document,
      '-ParentPid',
      '4242'
    ])
  })

  it('tells the loader where to keep its log when the hub names one', () => {
    const { spawn } = loaders()

    createWordSession({ ...files, spawn, parentPid: 4242, logFile: 'C:\\logs\\word-session.log' }).start()

    expect(spawn.mock.calls[0]?.[1].slice(-4)).toEqual([
      '-ParentPid',
      '4242',
      '-LogFile',
      'C:\\logs\\word-session.log'
    ])
  })

  it('starts one loader however often it is asked to', () => {
    const { spawn } = loaders()
    const session = createWordSession({ ...files, spawn, parentPid: 1 })

    session.start()
    session.start()

    expect(spawn).toHaveBeenCalledOnce()
  })

  it('restarts the loader when it exits unexpectedly', () => {
    vi.useFakeTimers()
    const { spawn, spawned } = loaders()
    createWordSession({ ...files, spawn, parentPid: 1 }).start()

    spawned[0]?.emit('exit', 1)
    vi.advanceTimersByTime(60_000)

    expect(spawn).toHaveBeenCalledTimes(2)
  })

  it('stops the loader and can start it again later', () => {
    const { spawn, spawned } = loaders()
    const session = createWordSession({ ...files, spawn, parentPid: 1 })

    session.start()
    session.stop()
    session.start()

    expect(spawned[0]?.killed).toBe(true)
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})

describe('spawnHidden', () => {
  it('forwards what the script prints and reports its exit code', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const child = spawnHidden(process.execPath, [
      '-e',
      "process.stdout.write('loaded'); process.stderr.write('oops'); process.exit(3)"
    ])

    const code = await new Promise<number>((resolve) => child.on('exit', resolve))

    expect(code).toBe(3)
    expect(log).toHaveBeenCalledWith('word-session: loaded')
    expect(error).toHaveBeenCalledWith('word-session: oops')
  })

  it('stops the script when the hub stops it', async () => {
    const child = spawnHidden(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'])
    const exited = new Promise<number>((resolve) => child.on('exit', resolve))

    expect(child.kill()).toBe(true)
    await exited
  })
})
