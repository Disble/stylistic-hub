// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ServerStatus } from '../../shared/bridge'
import { fakeHub, RUNNING } from '../fake-hub'
import { ServerScreen } from './ServerScreen'

afterEach(cleanup)

describe('ServerScreen', () => {
  it('shows the version, the address and that it runs', async () => {
    window.hub = fakeHub()
    render(<ServerScreen />)

    expect(await screen.findByText('Running')).toBeTruthy()
    expect(screen.getByText('Version 0.0.1')).toBeTruthy()
    expect(screen.getByText('https://localhost:3000')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a server that keeps crashing, as it happens', async () => {
    let push: (status: ServerStatus) => void = () => undefined
    window.hub = fakeHub({ server: { onStatus: (listener) => ((push = listener), () => undefined) } })
    render(<ServerScreen />)
    await screen.findByText('Running')

    act(() => push({ ...RUNNING, state: 'restarting', crashes: 3, lastExitCode: 1, restartInMs: 5000 }))

    expect(screen.getByText('Restarting')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(
      'The server stopped unexpectedly 3 times since the hub opened (last exit code 1). Restarting in 5 s.'
    )
  })

  it('keeps a past crash visible as a warning once the server runs again', async () => {
    window.hub = fakeHub({ server: { status: async () => ({ ...RUNNING, crashes: 1, lastExitCode: 9 }) } })
    render(<ServerScreen />)

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The server stopped unexpectedly 1 time since the hub opened (last exit code 9).'
    )
  })
})
