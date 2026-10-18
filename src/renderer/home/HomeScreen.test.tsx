// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryComponent, ModelSummary, ProviderSummary } from '../../shared/bridge'
import { WORD_MODULE_ID } from '../hub-state'
import { fakeHub, RUNNING } from '../fake-hub'
import { HomeScreen } from './HomeScreen'

afterEach(cleanup)

/** A signed-in subscription provider. */
const CHATGPT: ProviderSummary = { id: 'openai-codex', name: 'ChatGPT', configured: true, authMethods: [] }
/** The model chosen for corrections. */
const SOL: ModelSummary = { provider: 'openai-codex', id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol' }
/** Word with the certificate trusted and the add-in registered. */
const WORD_READY = { available: true, caTrusted: true, addinRegistered: true, version: '1.0.0.0' }

/** The Word module as the Library lists it: the id always comes from WORD_MODULE_ID, which the
 * catalog-fixture pin in word-integration.test.ts ties to catalog/catalog.source.json, so a wrong id
 * cannot hide behind a repeated literal. */
function wordModule(extra: Partial<LibraryComponent> = {}): LibraryComponent {
  return {
    id: WORD_MODULE_ID,
    kind: 'module',
    installed: null,
    requested: false,
    channel: 'stable',
    available: '2.0.0',
    history: [],
    ...extra
  }
}

/** A library whose catalog check succeeded and lists the Word module. */
function libraryWith(module: LibraryComponent) {
  return { firstRun: false, catalog: true, components: [module] }
}

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

  it('installs Stylistic for Word from the Home card through the Library, never automatically', async () => {
    const install = vi.fn(async () => undefined)
    window.hub = fakeHub({ library: { list: async () => libraryWith(wordModule()), install } })
    render(<HomeScreen onOpen={() => undefined} />)

    const card = await screen.findByRole('article', { name: 'Word add-in' })
    expect(card.textContent).toContain('2.0.0')
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(within(card).getByRole('button', { name: 'Install Stylistic for Word' }))

    await waitFor(() => expect(install).toHaveBeenCalledWith(WORD_MODULE_ID))
  })

  it('shows the pending download once the Word module is requested', async () => {
    const install = vi.fn(async () => undefined)
    window.hub = fakeHub({
      library: { list: async () => libraryWith(wordModule({ requested: true })), install }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    const card = await screen.findByRole('article', { name: 'Word add-in' })
    expect(card.textContent).toContain('Install requested')
    expect(within(card).queryByRole('button', { name: 'Install Stylistic for Word' })).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })

  it('shows the installed download version on the Home card', async () => {
    window.hub = fakeHub({ library: { list: async () => libraryWith(wordModule({ installed: '2.0.0' })) } })
    render(<HomeScreen onOpen={() => undefined} />)

    const card = await screen.findByRole('article', { name: 'Word add-in' })
    expect(card.textContent).toContain('2.0.0')
    expect(within(card).getByRole('button', { name: 'Add to Word' })).toBeTruthy()
  })

  it('shows why the Word download failed', async () => {
    window.hub = fakeHub({
      library: {
        list: async () => libraryWith(wordModule()),
        install: async () => Promise.reject(new Error(`${WORD_MODULE_ID} was refused`))
      }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    const card = await screen.findByRole('article', { name: 'Word add-in' })
    fireEvent.click(within(card).getByRole('button', { name: 'Install Stylistic for Word' }))

    expect(await within(card).findByText(`${WORD_MODULE_ID} was refused`)).toBeTruthy()
  })

  it('omits Install when the catalog lists no Word module', async () => {
    const install = vi.fn(async () => undefined)
    window.hub = fakeHub({
      library: { list: async () => ({ firstRun: false, catalog: true, components: [] }), install }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    const card = await screen.findByRole('article', { name: 'Word add-in' })
    expect(card.textContent).toContain('Not offered')
    expect(within(card).queryByRole('button', { name: 'Install Stylistic for Word' })).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })

  it('omits Install when the Word module has no offer', async () => {
    const install = vi.fn(async () => undefined)
    window.hub = fakeHub({
      library: { list: async () => libraryWith(wordModule({ available: null })), install }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    const card = await screen.findByRole('article', { name: 'Word add-in' })
    expect(card.textContent).toContain('Not offered')
    expect(within(card).queryByRole('button', { name: 'Install Stylistic for Word' })).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })

  it('shows Stylistic ready once a catalog check completes while mounted', async () => {
    const listeners: (() => void)[] = []
    const wordCurrent = { value: { available: true, caTrusted: false, addinRegistered: false } }
    window.hub = fakeHub({
      provider: { list: async () => [CHATGPT], getModel: async () => SOL },
      word: { status: async () => wordCurrent.value },
      library: {
        list: async () => libraryWith(wordModule({ installed: '2.0.0' })),
        onChecked: (listener: () => void) => {
          listeners.push(listener)
          return () => undefined
        }
      }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    expect(await screen.findByText('2 of 3 done')).toBeTruthy()
    wordCurrent.value = { ...WORD_READY }
    act(() => {
      for (const listener of listeners) listener()
    })

    expect(await screen.findByText('3 of 3 done')).toBeTruthy()
  })
})
