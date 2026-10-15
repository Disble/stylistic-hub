// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HubBridge, ModelSummary, ProviderSummary } from '../../shared/bridge'
import type { LoginEvent } from '../../shared/login/login'
import { fakeHub } from '../fake-hub'
import { ProviderScreen } from './ProviderScreen'

/** Providers the fake bridge reports. */
let providers: ProviderSummary[]
/** Models the fake bridge reports. */
let models: ModelSummary[]
/** The fake bridge's provider API. */
let api: HubBridge['provider']
/** Pushes a login event to the screen, as the main process would. */
let emit: (event: LoginEvent) => void

beforeEach(() => {
  // happy-dom cancels Web Animations on unmount and reports it; Fluent skips motion without `animate`.
  Object.defineProperty(Element.prototype, 'animate', { value: undefined, configurable: true })
  providers = [
    {
      id: 'openai-codex',
      name: 'ChatGPT Plus/Pro',
      configured: false,
      authMethods: [{ type: 'oauth', label: 'ChatGPT' }]
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      configured: true,
      authMethods: [
        { type: 'oauth', label: 'Claude Pro/Max' },
        { type: 'api_key', label: 'Anthropic API key' }
      ]
    },
    { id: 'groq', name: 'Groq', configured: false, authMethods: [{ type: 'api_key', label: 'Groq API key' }] }
  ]
  models = [
    { provider: 'anthropic', id: 'claude-a', name: 'Claude A' },
    { provider: 'anthropic', id: 'claude-b', name: 'Claude B' }
  ]
  const listeners = new Set<(event: LoginEvent) => void>()
  emit = (event) => act(() => listeners.forEach((l) => l(event)))
  api = {
    list: vi.fn(async () => providers),
    listModels: vi.fn(async () => models),
    getModel: vi.fn(async () => models[0]),
    setModel: vi.fn(async (provider: string, id: string) => ({ provider, id, name: id })),
    logout: vi.fn(async () => undefined),
    startLogin: vi.fn(async () => 'l1'),
    answerPrompt: vi.fn(async () => undefined),
    cancelLogin: vi.fn(async () => undefined),
    onLoginEvent: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
  // The same object, not a copy: tests swap its methods after the screen mounts.
  window.hub = { ...fakeHub(), provider: api }
})

afterEach(cleanup)

/** Renders the screen and waits for its first load. */
async function renderScreen() {
  render(<ProviderScreen />)
  await screen.findByText('ChatGPT Plus/Pro')
}

describe('ProviderScreen', () => {
  it('lists subscription sign-ins with their state', async () => {
    await renderScreen()

    const chatgpt = screen.getByRole('listitem', { name: 'ChatGPT Plus/Pro' })
    const anthropic = screen.getByRole('listitem', { name: 'Anthropic' })

    expect(within(chatgpt).getByRole('button', { name: 'Sign in' })).toBeTruthy()
    expect(within(anthropic).getByText('Connected')).toBeTruthy()
    expect(screen.queryByRole('listitem', { name: 'Groq' })).toBeNull()
  })

  it('shows the chosen model and stores a new choice', async () => {
    await renderScreen()
    const select = screen.getByLabelText('Model for corrections') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('anthropic/claude-a'))

    fireEvent.change(select, { target: { value: 'anthropic/claude-b' } })

    await waitFor(() => expect(api.setModel).toHaveBeenCalledWith('anthropic', 'claude-b'))
  })

  it('asks to sign in first when no model is available', async () => {
    models = []
    await renderScreen()

    expect(await screen.findByText('Sign in to a provider to choose a model.')).toBeTruthy()
  })

  it('signs in with a subscription through the dialog and refreshes when it is done', async () => {
    await renderScreen()

    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'ChatGPT Plus/Pro' })).getByRole('button', {
        name: 'Sign in'
      })
    )
    await waitFor(() => expect(api.startLogin).toHaveBeenCalledWith('openai-codex', 'oauth'))
    emit({
      loginId: 'l1',
      providerId: 'openai-codex',
      type: 'login-notice',
      notice: { type: 'auth_url', url: 'https://auth.test/x' }
    })

    const dialog = await screen.findByRole('dialog', { name: 'Sign in to ChatGPT Plus/Pro' })
    expect(within(dialog).getByRole('link', { name: 'Open the sign-in page' }).getAttribute('href')).toBe(
      'https://auth.test/x'
    )

    providers = providers.map((p) => (p.id === 'openai-codex' ? { ...p, configured: true } : p))
    emit({ loginId: 'l1', providerId: 'openai-codex', type: 'login-done' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      within(screen.getByRole('listitem', { name: 'ChatGPT Plus/Pro' })).getByText('Connected')
    ).toBeTruthy()
  })

  it('answers a secret prompt and a choice prompt', async () => {
    await renderScreen()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'groq' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with an API key' }))
    await waitFor(() => expect(api.startLogin).toHaveBeenCalledWith('groq', 'api_key'))

    emit({
      loginId: 'l1',
      providerId: 'groq',
      type: 'login-prompt',
      promptId: 'p1',
      prompt: { type: 'secret', message: 'Groq API key' }
    })
    const key = await screen.findByLabelText('Groq API key')
    expect(key.getAttribute('type')).toBe('password')
    fireEvent.change(key, { target: { value: 'gsk-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.answerPrompt).toHaveBeenCalledWith('l1', 'p1', 'gsk-1'))

    emit({ loginId: 'l1', providerId: 'groq', type: 'login-prompt-closed', promptId: 'p1' })
    emit({
      loginId: 'l1',
      providerId: 'groq',
      type: 'login-prompt',
      promptId: 'p2',
      prompt: {
        type: 'select',
        message: 'Region',
        options: [
          { id: 'eu', label: 'Europe' },
          { id: 'us', label: 'United States' }
        ]
      }
    })
    fireEvent.click(await screen.findByLabelText('United States'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(api.answerPrompt).toHaveBeenCalledWith('l1', 'p2', 'us'))
  })

  it('shows a device code to type on the provider page', async () => {
    await renderScreen()
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'ChatGPT Plus/Pro' })).getByRole('button', {
        name: 'Sign in'
      })
    )
    await waitFor(() => expect(api.startLogin).toHaveBeenCalled())

    emit({
      loginId: 'l1',
      providerId: 'openai-codex',
      type: 'login-notice',
      notice: { type: 'device_code', userCode: 'ABCD-1234', verificationUri: 'https://device.test' }
    })

    expect(await screen.findByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://device.test' })).toBeTruthy()
  })

  it('shows why a sign-in failed and cancels a running one', async () => {
    await renderScreen()
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'ChatGPT Plus/Pro' })).getByRole('button', {
        name: 'Sign in'
      })
    )
    await waitFor(() => expect(api.startLogin).toHaveBeenCalled())
    emit({
      loginId: 'l1',
      providerId: 'openai-codex',
      type: 'login-notice',
      notice: { type: 'progress', message: 'Waiting for the browser' }
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(api.cancelLogin).toHaveBeenCalledWith('l1'))

    emit({
      loginId: 'l1',
      providerId: 'openai-codex',
      type: 'login-failed',
      message: 'Token exchange failed',
      cancelled: false
    })
    expect(await screen.findByText('Token exchange failed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('signs out of a connected provider', async () => {
    await renderScreen()

    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'Anthropic' })).getByRole('button', { name: 'Sign out' })
    )

    await waitFor(() => expect(api.logout).toHaveBeenCalledWith('anthropic'))
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
  })

  it('signs out of a provider connected with an API key', async () => {
    providers = providers.map((p) => (p.id === 'groq' ? { ...p, configured: true } : p))
    await renderScreen()

    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'groq' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of Groq' }))

    await waitFor(() => expect(api.logout).toHaveBeenCalledWith('groq'))
  })

  it('shows the links of an information notice', async () => {
    await renderScreen()
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'ChatGPT Plus/Pro' })).getByRole('button', {
        name: 'Sign in'
      })
    )
    await waitFor(() => expect(api.startLogin).toHaveBeenCalled())

    emit({
      loginId: 'l1',
      providerId: 'openai-codex',
      type: 'login-notice',
      notice: {
        type: 'info',
        message: 'Create a key first.',
        links: [{ url: 'https://keys.test', label: 'Key page' }]
      }
    })

    expect((await screen.findByRole('link', { name: 'Key page' })).getAttribute('href')).toBe(
      'https://keys.test'
    )
  })

  it('shows why an action failed', async () => {
    api.setModel = vi.fn(async () => {
      throw new Error('Model anthropic/claude-b is not available')
    })
    await renderScreen()
    const select = screen.getByLabelText('Model for corrections')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('anthropic/claude-a'))

    fireEvent.change(select, { target: { value: 'anthropic/claude-b' } })

    expect(await screen.findByText('Model anthropic/claude-b is not available')).toBeTruthy()
  })
})
