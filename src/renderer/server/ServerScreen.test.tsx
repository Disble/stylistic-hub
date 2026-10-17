// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServerStatus } from '../../shared/bridge'
import { fakeHub, RUNNING } from '../fake-hub'
import { ServerScreen } from './ServerScreen'

afterEach(cleanup)

/** A signed-in subscription provider. */
const CHATGPT = { id: 'openai-codex', name: 'ChatGPT', configured: true, authMethods: [] }
/** The model chosen for corrections. */
const SOL = { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }

describe('ServerScreen', () => {
  it('shows the version, the address and that each service runs', async () => {
    window.hub = fakeHub()
    render(<ServerScreen onOpen={() => undefined} />)

    expect(await screen.findByText('Version 0.0.1')).toBeTruthy()
    const services = screen.getByRole('region', { name: 'Services' })
    const api = within(services).getByRole('article', { name: 'Analysis API' })
    expect(api.textContent).toContain('Running')
    expect(api.textContent).toContain('https://localhost:3000/api')
    expect(within(services).getByRole('article', { name: 'Database' }).textContent).toContain('Ready')
    expect(within(services).getByRole('article', { name: 'Word access' }).textContent).toContain('Secured')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('surfaces a server that keeps crashing, as it happens', async () => {
    let push: (status: ServerStatus) => void = () => undefined
    window.hub = fakeHub({ server: { onStatus: (listener) => ((push = listener), () => undefined) } })
    render(<ServerScreen onOpen={() => undefined} />)
    await screen.findByText('Version 0.0.1')

    act(() => push({ ...RUNNING, state: 'restarting', crashes: 3, lastExitCode: 1, restartInMs: 5000 }))

    expect(screen.getByRole('article', { name: 'Analysis API' }).textContent).toContain('Restarting')
    expect(screen.getByRole('article', { name: 'Database' }).textContent).toContain('Unavailable')
    expect(screen.getByRole('alert').textContent).toContain(
      'The server stopped unexpectedly 3 times since the hub opened (last exit code 1). Restarting in 5 s.'
    )
  })

  it('keeps a past crash visible as a warning once the server runs again', async () => {
    window.hub = fakeHub({ server: { status: async () => ({ ...RUNNING, crashes: 1, lastExitCode: 9 }) } })
    render(<ServerScreen onOpen={() => undefined} />)

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The server stopped unexpectedly 1 time since the hub opened (last exit code 9).'
    )
  })

  it('restarts the server on request', async () => {
    const restart = vi.fn(async () => undefined)
    window.hub = fakeHub({ server: { restart } })
    render(<ServerScreen onOpen={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Restart' }))

    await waitFor(() => expect(restart).toHaveBeenCalledOnce())
  })

  it('opens the logs folder, and says why when it cannot', async () => {
    const openLogs = vi.fn(async () => Promise.reject(new Error('Folder not found')))
    window.hub = fakeHub({ server: { openLogs } })
    render(<ServerScreen onOpen={() => undefined} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Open logs folder' }))

    expect(await screen.findByText('Folder not found')).toBeTruthy()
    expect(openLogs).toHaveBeenCalledOnce()
  })

  it('shows the AI provider in use and opens its screen', async () => {
    const onOpen = vi.fn()
    window.hub = fakeHub({ provider: { list: async () => [CHATGPT], getModel: async () => SOL } })
    render(<ServerScreen onOpen={onOpen} />)

    const provider = await screen.findByRole('region', { name: 'AI provider' })
    expect(await within(provider).findByText('GPT-5.6 Sol')).toBeTruthy()
    expect(provider.textContent).toContain('ChatGPT')
    fireEvent.click(within(provider).getByRole('button', { name: 'Change provider' }))

    expect(onOpen).toHaveBeenCalledWith('provider')
  })

  it('says when no AI provider is connected yet', async () => {
    window.hub = fakeHub()
    render(<ServerScreen onOpen={() => undefined} />)

    const provider = await screen.findByRole('region', { name: 'AI provider' })
    expect(await within(provider).findByText('No provider connected')).toBeTruthy()
    expect(within(provider).getByRole('button', { name: 'Connect a provider' })).toBeTruthy()
  })

  it('shows the runtime the hub runs on', async () => {
    window.hub = fakeHub()
    render(<ServerScreen onOpen={() => undefined} />)

    expect((await screen.findByRole('region', { name: 'This computer' })).textContent).toContain(
      'Electron 44.7.2 · Node 24.21.0'
    )
  })
})
