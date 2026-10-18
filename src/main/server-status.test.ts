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

  it('shows a requested restart as starting, without counting it as a crash', () => {
    const listener = vi.fn()
    const status = createServerStatus({ version: '0.0.1', address: 'a', onChange: listener })
    status.started()

    status.restartRequested()

    expect(status.get()).toEqual({ state: 'starting', version: '0.0.1', address: 'a', crashes: 0 })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'starting' }))
  })
  it('shows a rollback with its reason, and keeps the reason once the earlier version runs', () => {
    const listener = vi.fn()
    const status = createServerStatus({ version: '0.0.1', address: 'a', onChange: listener })
    status.started()

    status.rolledBack('Server 1.1.0 failed its health check; rolled back to 1.0.0.')
    status.setVersion('1.0.0')

    expect(status.get()).toEqual({
      state: 'rolled-back',
      version: '1.0.0',
      address: 'a',
      crashes: 0,
      reason: 'Server 1.1.0 failed its health check; rolled back to 1.0.0.'
    })
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ version: '1.0.0' }))
    status.started()
    expect(status.get()).toMatchObject({ state: 'running', reason: expect.stringContaining('1.1.0') })
  })

  it('adds a reason without changing the state', () => {
    const status = createServerStatus({ version: '0.0.1', address: 'a', onChange: () => undefined })
    status.exited({ code: 1, restartInMs: 1000 })

    status.setReason('No earlier version')

    expect(status.get()).toMatchObject({ state: 'restarting', reason: 'No earlier version' })
  })
})
