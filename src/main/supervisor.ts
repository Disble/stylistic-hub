/** The part of a child process the supervisor relies on; Electron's UtilityProcess fits it. */
export interface SupervisedChild {
  on(event: 'exit', listener: (code: number) => void): void
  kill(): boolean
}

/** How to start the child and how long to wait between restarts. */
export interface SupervisorOptions {
  spawn: () => SupervisedChild
  /** Delays for consecutive crashes; the last one repeats. */
  backoffMs: readonly number[]
  /** A run this long counts as healthy and resets the backoff. Defaults to one minute. */
  stableAfterMs?: number
  /** Called on every unexpected exit, before the restart is scheduled. */
  onExit?: (event: { code: number; restartInMs: number }) => void
  /**
   * After `exits` exits of runs that never reached `stableAfterMs`, `onCrashLoop` is asked first: when it
   * returns true it takes over and no restart is scheduled; when false the backoff goes on.
   */
  crashLoop?: { exits: number; onCrashLoop: () => boolean }
}

/** Controls one supervised child process. */
export interface Supervisor {
  start(): void
  /** Replaces the child on request: the new one starts once the old one has exited, from the first delay. */
  restart(): void
  /** Stops for good: cancels a pending restart and kills the running child. */
  stop(): void
  /** Stops until the next `start`: cancels a pending restart, kills the child and resolves once it exited. */
  halt(): Promise<void>
}

/**
 * Keeps one child process running, restarting it with backoff when it exits unexpectedly.
 * Custom code: no maintained package supervises Electron's utilityProcess (docs/architecture.md).
 */
export function createSupervisor({
  spawn,
  backoffMs,
  stableAfterMs = 60_000,
  onExit,
  crashLoop
}: SupervisorOptions): Supervisor {
  let child: SupervisedChild | undefined
  let restartTimer: ReturnType<typeof setTimeout> | undefined
  let attempt = 0
  /** Exits in a row of runs that never became stable. */
  let unstableExits = 0
  let stopped = false

  const launch = () => {
    restartTimer = undefined
    const startedAt = Date.now()
    const current = spawn()
    child = current
    current.on('exit', (code) => {
      if (stopped || child !== current) return
      child = undefined
      if (Date.now() - startedAt >= stableAfterMs) {
        attempt = 0
        unstableExits = 0
      } else {
        unstableExits += 1
      }
      if (crashLoop && unstableExits >= crashLoop.exits && crashLoop.onCrashLoop()) {
        attempt = 0
        unstableExits = 0
        return
      }
      const restartInMs = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 0
      attempt += 1
      onExit?.({ code, restartInMs })
      restartTimer = setTimeout(launch, restartInMs)
    })
  }

  return {
    start() {
      if (stopped || child || restartTimer) return
      launch()
    },
    restart() {
      if (stopped) return
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = undefined
      attempt = 0
      unstableExits = 0
      const previous = child
      if (!previous) {
        launch()
        return
      }
      // Detached first, so its exit is not a crash; the new child must not race it for the port.
      child = undefined
      previous.on('exit', () => {
        if (!stopped && !child && !restartTimer) launch()
      })
      previous.kill()
    },
    stop() {
      stopped = true
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = undefined
      child?.kill()
      child = undefined
    },
    halt() {
      if (restartTimer) clearTimeout(restartTimer)
      restartTimer = undefined
      attempt = 0
      unstableExits = 0
      const previous = child
      child = undefined
      if (!previous) return Promise.resolve()
      return new Promise<void>((resolve) => {
        previous.on('exit', () => resolve())
        previous.kill()
      })
    }
  }
}
