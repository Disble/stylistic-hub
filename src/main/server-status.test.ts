import { describe, expect, it, vi } from 'vitest'
import { createServerStatus } from './server-status'

describe('createServerStatus', () => {
  it('starts as starting, with the server version and address', () => {
    const status = createServerStatus({
      version: '0.0.1',
      address: 'https://localhost:3000',
      onChange: () => undefined
    })

    expect(status.get()).toEqual({
      state: 'starting',
      version: '0.0.1',
      address: 'https://localhost:3000',
      crashes: 0
    })
  })

  it('reports a running process and notifies each change', () => {
    const listener = vi.fn()
    const status = createServerStatus({ version: '0.0.1', address: 'a', onChange: listener })

    status.started()

    expect(status.get().state).toBe('running')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: 'running' }))
  })

  it('counts crashes since the hub opened, with the last exit code and the pending restart', () => {
    const status = createServerStatus({ version: '0.0.1', address: 'a', onChange: () => undefined })

    status.started()
    status.exited({ code: 1, restartInMs: 1000 })
    status.started()
    status.exited({ code: 7, restartInMs: 2000 })

    expect(status.get()).toMatchObject({
      state: 'restarting',
      crashes: 2,
      lastExitCode: 7,
      restartInMs: 2000
    })

    status.started()

    expect(status.get()).toMatchObject({ state: 'running', crashes: 2, lastExitCode: 7 })
    expect(status.get().restartInMs).toBeUndefined()
  })
})
