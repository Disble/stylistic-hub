// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSummary, ProviderSummary } from '../../shared/bridge'
import { fakeHub, RUNNING } from '../fake-hub'
import { HomeScreen } from './HomeScreen'

afterEach(cleanup)

/** A signed-in subscription provider. */
const CHATGPT: ProviderSummary = { id: 'openai-codex', name: 'ChatGPT', configured: true, authMethods: [] }
/** The model chosen for corrections. */
const SOL: ModelSummary = { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }
/** Word with the certificate trusted and the add-in registered. */
const WORD_READY = { available: true, caTrusted: true, addinRegistered: true, version: '1.0.0.0' }

describe('HomeScreen', () => {
  it('lists the setup steps with what is already done', async () => {
    window.hub = fakeHub({ provider: { list: async () => [CHATGPT], getModel: async () => SOL } })
    render(<HomeScreen onOpen={() => undefined} />)

    expect(await screen.findByText('2 of 3 done')).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Local server running · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'AI provider connected · GPT-5.6 Sol · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Stylistic added to Word · to do' })).toBeTruthy()
  })

  it('offers the first step that is not done, and opens its screen', async () => {
    const onOpen = vi.fn()
    window.hub = fakeHub()
    render(<HomeScreen onOpen={onOpen} />)

    const next = await screen.findByRole('region', { name: 'Next step' })
    expect(within(next).getByRole('heading', { name: 'Connect an AI provider' })).toBeTruthy()
    fireEvent.click(within(next).getByRole('button', { name: 'Connect a provider' }))

    expect(onOpen).toHaveBeenCalledWith('provider')
  })

  it('counts a signed-in provider without a chosen model as not done', async () => {
    window.hub = fakeHub({ provider: { list: async () => [CHATGPT], getModel: async () => undefined } })
    render(<HomeScreen onOpen={() => undefined} />)

    const next = await screen.findByRole('region', { name: 'Next step' })
    expect(await within(next).findByRole('heading', { name: 'Choose a model for corrections' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'AI provider connected · to do' })).toBeTruthy()
  })

  it('offers to add Stylistic to Word once the provider is ready', async () => {
    const onOpen = vi.fn()
    window.hub = fakeHub({ provider: { list: async () => [CHATGPT], getModel: async () => SOL } })
    render(<HomeScreen onOpen={onOpen} />)

    const next = await screen.findByRole('region', { name: 'Next step' })
    expect(await within(next).findByRole('heading', { name: 'Add Stylistic to Word' })).toBeTruthy()
    fireEvent.click(within(next).getByRole('button', { name: 'Add to Word' }))

    expect(onOpen).toHaveBeenCalledWith('word')
  })

  it('says Stylistic is ready in Word when every step is done', async () => {
    window.hub = fakeHub({
      provider: { list: async () => [CHATGPT], getModel: async () => SOL },
      word: { status: async () => WORD_READY }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    expect(await screen.findByText('3 of 3 done')).toBeTruthy()
    const next = screen.getByRole('region', { name: 'Next step' })
    expect(within(next).getByRole('heading', { name: 'Stylistic is ready in Word' })).toBeTruthy()
    expect(within(next).queryByRole('button')).toBeNull()
  })

  it('shows each component with its own version and opens its screen', async () => {
    const onOpen = vi.fn()
    window.hub = fakeHub()
    render(<HomeScreen onOpen={onOpen} />)

    const word = await screen.findByRole('article', { name: 'Word add-in' })
    const server = screen.getByRole('article', { name: 'Local server' })
    expect(word.textContent).toContain('1.0.0.0')
    expect(word.textContent).toContain('Not added')
    expect(server.textContent).toContain('0.0.1')
    expect(server.textContent).toContain('https://localhost:3000')
    expect(server.textContent).toContain('Running')

    fireEvent.click(within(word).getByRole('button', { name: 'Add to Word' }))
    fireEvent.click(within(server).getByRole('button', { name: 'Manage server' }))

    expect(onOpen.mock.calls).toEqual([['word'], ['server']])
  })

  it('shows Word as added once the certificate is trusted and the add-in registered', async () => {
    window.hub = fakeHub({ word: { status: async () => WORD_READY } })
    render(<HomeScreen onOpen={() => undefined} />)

    const word = await screen.findByRole('article', { name: 'Word add-in' })
    expect(await within(word).findByRole('button', { name: 'Manage Word' })).toBeTruthy()
    expect(word.textContent).toContain('Added')
  })

  it('shows the server state in the header', async () => {
    window.hub = fakeHub()
    render(<HomeScreen onOpen={() => undefined} />)

    expect(await screen.findByText('Server running · localhost:3000')).toBeTruthy()
  })

  it.each([
    ['starting', 'The local server is starting', 'This takes a few seconds.'],
    [
      'restarting',
      'The local server stopped',
      'The hub is starting it again. If it keeps stopping, the Server screen says why.'
    ]
  ] as const)('says what the server is doing while it is %s', async (state, title, body) => {
    window.hub = fakeHub({ server: { status: async () => ({ ...RUNNING, state }) } })
    render(<HomeScreen onOpen={() => undefined} />)

    const next = await screen.findByRole('region', { name: 'Next step' })
    expect(within(next).getByRole('heading', { name: title })).toBeTruthy()
    expect(next.textContent).toContain(body)
    expect(within(next).getByRole('button', { name: 'Open Server' })).toBeTruthy()
  })
})
