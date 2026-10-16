import { spawn as spawnProcess } from 'node:child_process'
import { createSupervisor, type SupervisedChild, type Supervisor } from './supervisor'

/** Starts the loader process; Node's `child_process.spawn` fits it. */
export type SpawnLoader = (command: string, args: string[]) => SupervisedChild

/** What the Word session loader runs. */
export interface WordSessionOptions {
  /** `word-session.ps1`, which watches Word and loads Stylistic into each new session. */
  script: string
  /** The bundled document that refers to the sideloaded add-in. */
  document: string
  /** The hub's process id; the script exits when the hub is gone. */
  parentPid: number
  spawn?: SpawnLoader
}

/** Runs PowerShell hidden and forwards what the script reports to the hub's log. */
export const spawnHidden: SpawnLoader = (command, args) => {
  const child = spawnProcess(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk: Buffer) => console.log(`word-session: ${chunk.toString().trim()}`))
  child.stderr.on('data', (chunk: Buffer) => console.error(`word-session: ${chunk.toString().trim()}`))
  return {
    on: (_event, listener) => child.on('exit', (code) => listener(code ?? 1)),
    kill: () => child.kill()
  }
}

/**
 * Keeps Stylistic in every Word session for as long as the hub runs. Registering the add-in only lets Word find
 * it; Word loads it when it shows a document that refers to it, so a supervised PowerShell script does that once
 * per Word session through Word's COM automation. Custom code: no tool loads a sideloaded add-in into a running
 * Word (docs/architecture.md).
 */
export function createWordSession({ script, document, parentPid, spawn = spawnHidden }: WordSessionOptions) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
    '-Document',
    document,
    '-ParentPid',
    String(parentPid)
  ]
  let supervisor: Supervisor | undefined

  return {
    start() {
      if (supervisor) return
      supervisor = createSupervisor({
        spawn: () => spawn('powershell.exe', args),
        backoffMs: [2_000, 10_000, 60_000]
      })
      supervisor.start()
    },
    stop() {
      supervisor?.stop()
      supervisor = undefined
    }
  }
}
