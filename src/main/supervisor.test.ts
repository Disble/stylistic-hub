import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSupervisor, type SupervisedChild } from './supervisor'

/** A child process stand-in that exits when the test says so. */
class FakeChild implements SupervisedChild {
  killed = false
  private exitListener: ((code: number) => void) | undefined

  on(_event: 'exit', listener: (code: number) => void): void {
    this.exitListener = listener
  }

  kill(): boolean {
    this.killed = true
    this.exitListener?.(0)
    return true
  }

  crash(code = 1): void {
    this.exitListener?.(code)
  }
}

/** Every child spawned in the current test, in order. */
let children: FakeChild[]
/** Spawns a fake child and records it. */
const spawn = () => {
  const child = new FakeChild()
  children.push(child)
  return child
}

beforeEach(() => {
  vi.useFakeTimers()
  children = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createSupervisor', () => {
  it('starts the child once', () => {
    createSupervisor({ spawn, backoffMs: [1000, 5000] }).start()

    expect(children).toHaveLength(1)
  })

  it('restarts a crashed child after the first backoff delay', () => {
    createSupervisor({ spawn, backoffMs: [1000, 5000] }).start()
    children[0]?.crash()

    vi.advanceTimersByTime(999)
    expect(children).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(2)
  })

  it('waits longer after each consecutive crash and stays at the last delay', () => {
    createSupervisor({ spawn, backoffMs: [1000, 5000] }).start()

    children[0]?.crash()
    vi.advanceTimersByTime(1000)
    children[1]?.crash()
    vi.advanceTimersByTime(4999)
    expect(children).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(3)

    children[2]?.crash()
    vi.advanceTimersByTime(5000)
    expect(children).toHaveLength(4)
  })

  it('goes back to the first delay after a run that lasted', () => {
    createSupervisor({ spawn, backoffMs: [1000, 5000], stableAfterMs: 60_000 }).start()
    children[0]?.crash()
    vi.advanceTimersByTime(1000)

    vi.advanceTimersByTime(60_000)
    children[1]?.crash()
    vi.advanceTimersByTime(1000)

    expect(children).toHaveLength(3)
  })

  it('does not restart after stop, and kills the running child', () => {
    const supervisor = createSupervisor({ spawn, backoffMs: [1000] })
    supervisor.start()

    supervisor.stop()
    vi.advanceTimersByTime(10_000)

    expect(children[0]?.killed).toBe(true)
    expect(children).toHaveLength(1)
  })

  it('cancels a pending restart on stop', () => {
    const supervisor = createSupervisor({ spawn, backoffMs: [1000] })
    supervisor.start()
    children[0]?.crash()

    supervisor.stop()
    vi.advanceTimersByTime(10_000)

    expect(children).toHaveLength(1)
  })

  it('reports each unexpected exit', () => {
    const onExit = vi.fn()
    createSupervisor({ spawn, backoffMs: [1000], onExit }).start()

    children[0]?.crash(3)

    expect(onExit).toHaveBeenCalledWith({ code: 3, restartInMs: 1000 })
  })
})
