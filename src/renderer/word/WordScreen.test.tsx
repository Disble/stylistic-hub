// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LibraryComponent, WordStatus } from '../../shared/bridge'
import { WORD_MODULE_ID } from '../hub-state'
import { fakeHub } from '../fake-hub'
import { WordScreen } from './WordScreen'

afterEach(cleanup)

/** Word before anything was added. */
const NEW: WordStatus = { available: true, caTrusted: false, addinRegistered: false, version: '1.0.0.0' }
/** Word with the certificate trusted and the add-in registered. */
const READY: WordStatus = { available: true, caTrusted: true, addinRegistered: true, version: '1.0.0.0' }

/** Shows the Word screen over a hub whose Word status is `status`. */
function renderWith(status: WordStatus, word: Partial<typeof window.hub.word> = {}, library = {}) {
  const current = { value: status }
  window.hub = fakeHub({ word: { status: async () => current.value, ...word }, library })
  render(<WordScreen />)
  return current
}

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

/** A library whose catalog check succeeded and lists `components`. */
function libraryWith(components: LibraryComponent[]) {
  return { list: async () => ({ firstRun: false, catalog: true, components }) }
}

/** Word with no downloaded module: the hub cannot add anything yet. */
const DOWNLOADING: WordStatus = { available: false, caTrusted: false, addinRegistered: false }

describe('WordScreen', () => {
  it('adds Stylistic to Word and shows the steps done', async () => {
    const connect = vi.fn(async () => undefined)
    const current = renderWith(NEW, { connect })
    expect(await screen.findByText('Step 1 of 3')).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Trust this computer’s certificate · to do' })).toBeTruthy()

    current.value = READY
    fireEvent.click(screen.getByRole('button', { name: 'Add to Word' }))

    expect(await screen.findByRole('listitem', { name: 'Add Stylistic to Word · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Trust this computer’s certificate · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Open a document in Word · done' })).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(connect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Add to Word' })).toBeNull()
  })

  it('tells the user to answer the Windows prompt while it adds Stylistic', async () => {
    let finish: () => void = () => undefined
    renderWith(NEW, { connect: () => new Promise<void>((resolve) => (finish = resolve)) })

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Word' }))

    expect((await screen.findByRole('status')).textContent).toContain('choose Yes')
    expect(screen.getByRole('button', { name: 'Adding to Word…' }).hasAttribute('disabled')).toBe(true)
    finish()
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('shows why adding failed, for example a declined Windows prompt', async () => {
    renderWith(NEW, {
      connect: async () => Promise.reject(new Error('Windows did not trust the hub certificate'))
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Word' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Stylistic was not added to Word')
    expect(alert.textContent).toContain('Windows did not trust the hub certificate')
  })

  it('says what really happens in Word once it is ready', async () => {
    renderWith(READY)

    const word = await screen.findByRole('listitem', { name: 'Open a document in Word · done' })
    expect(word.textContent).toContain('Home tab')
    expect(word.textContent).toContain('a second window for about a second')
  })

  it('repairs the installation by adding Stylistic again', async () => {
    const connect = vi.fn(async () => undefined)
    renderWith(READY, { connect })

    fireEvent.click(await screen.findByRole('button', { name: 'Repair installation' }))

    await waitFor(() => expect(connect).toHaveBeenCalledOnce())
  })

  it('removes Stylistic from Word', async () => {
    const disconnect = vi.fn(async () => undefined)
    const current = renderWith(READY, { disconnect })

    current.value = { ...READY, addinRegistered: false }
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Word' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to Word' })).toBeTruthy())
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('lists the add-in details', async () => {
    renderWith(READY)

    const details = await screen.findByRole('complementary', { name: 'Details' })
    expect(details.textContent).toContain('1.0.0.0')
    expect(details.textContent).toContain('https://localhost:3000')
  })

  it('installs Stylistic for Word from the Library when nothing is downloaded yet', async () => {
    const install = vi.fn(async () => undefined)
    renderWith(DOWNLOADING, {}, { ...libraryWith([wordModule({ available: '2.0.0' })]), install })

    expect(await screen.findByText(/not downloaded yet/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to Word' })).toBeNull()
    expect(install).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Install Stylistic for Word' }))

    await waitFor(() => expect(install).toHaveBeenCalledWith(WORD_MODULE_ID))
  })

  it('says the download is requested and checks the catalog on demand', async () => {
    const check = vi.fn(async () => undefined)
    renderWith(DOWNLOADING, {}, { ...libraryWith([wordModule({ requested: true })]), check })

    expect(await screen.findByText(/Install requested/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))

    await waitFor(() => expect(check).toHaveBeenCalledOnce())
  })

  it('shows why the Word download failed', async () => {
    renderWith(
      DOWNLOADING,
      {},
      {
        ...libraryWith([wordModule({ available: '2.0.0' })]),
        install: async () => Promise.reject(new Error(`${WORD_MODULE_ID} was refused`))
      }
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Install Stylistic for Word' }))

    expect(await screen.findByText(`${WORD_MODULE_ID} was refused`)).toBeTruthy()
  })

  it('shows why the catalog check failed', async () => {
    renderWith(
      DOWNLOADING,
      {},
      {
        ...libraryWith([wordModule({ requested: true })]),
        check: async () => Promise.reject(new Error('catalog is expired'))
      }
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Check now' }))

    expect(await screen.findByText('catalog is expired')).toBeTruthy()
  })

  it('shows no Install when the catalog offers no Word module', async () => {
    const install = vi.fn(async () => undefined)
    renderWith(
      DOWNLOADING,
      {},
      { list: async () => ({ firstRun: false, catalog: true, components: [] }), install }
    )

    expect(await screen.findByText(/not offered by the catalog/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install Stylistic for Word' })).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })

  it('shows Word controls after late module readiness, not the early catalog notification', async () => {
    const listeners: (() => void)[] = []
    const current = { value: DOWNLOADING }
    const status = vi.fn(async () => current.value)
    window.hub = fakeHub({
      word: { status },
      library: {
        ...libraryWith([wordModule({ requested: true })]),
        onChecked: (listener: () => void) => {
          listeners.push(listener)
          return () => undefined
        }
      }
    })
    render(<WordScreen />)

    expect(await screen.findByText(/Install requested/)).toBeTruthy()
    // The catalog reports its download before asynchronous module resolution and health checks finish.
    act(() => {
      for (const listener of listeners) listener()
    })
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('button', { name: 'Add to Word' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Repair installation' })).toBeNull()

    current.value = READY
    act(() => {
      for (const listener of listeners) listener()
    })

    expect(await screen.findByRole('button', { name: 'Repair installation' })).toBeTruthy()
  })

  it('unsubscribes its catalog refresh when unmounted', async () => {
    const listeners: (() => void)[] = []
    const unsubs: (() => void)[] = []
    window.hub = fakeHub({
      library: {
        onChecked: (listener: () => void) => {
          listeners.push(listener)
          const unsub = vi.fn()
          unsubs.push(unsub)
          return unsub
        }
      }
    })
    render(<WordScreen />)

    expect(await screen.findByRole('heading', { name: 'Stylistic for Word' })).toBeTruthy()
    // Both the library and the Word readiness follow each catalog check.
    expect(listeners).toHaveLength(2)
    cleanup()

    expect(unsubs).toHaveLength(2)
    for (const unsub of unsubs) expect(unsub).toHaveBeenCalledOnce()
  })

  it('says the module is downloaded but the hub is not ready to add it yet', async () => {
    renderWith(DOWNLOADING, {}, libraryWith([wordModule({ installed: '2.0.0' })]))

    expect(await screen.findByText(/downloaded, but the hub is not ready/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install Stylistic for Word' })).toBeNull()
  })
})
