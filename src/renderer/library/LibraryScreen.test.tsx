// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Library, LibraryComponent } from '../../shared/bridge'
import { fakeHub } from '../fake-hub'
import { LibraryScreen } from './LibraryScreen'

afterEach(cleanup)

/** A card with nothing installed, on stable, with no history. */
function card(
  id: string,
  kind: LibraryComponent['kind'],
  extra: Partial<LibraryComponent> = {}
): LibraryComponent {
  return {
    id,
    kind,
    installed: null,
    requested: false,
    channel: 'stable',
    available: null,
    history: [],
    ...extra
  }
}

/** A hub with a server, the hub, an installed add-in and a glossary module in the catalog. */
const LIBRARY: Library = {
  firstRun: false,
  catalog: true,
  components: [
    card('server', 'server', {
      installed: '1.0.0',
      available: '1.1.0',
      history: [
        {
          time: '2026-10-18T10:00:00.000Z',
          from: null,
          to: '1.0.0',
          outcome: 'installed',
          reason: null
        }
      ]
    }),
    card('stylistic-hub', 'hub', { installed: '0.9.0', available: '0.9.0' }),
    card('word-addin', 'module', { installed: '2.0.0', available: '2.0.0', channel: 'beta' }),
    card('glossary', 'module', { available: '0.1.0' })
  ]
}

/** Renders the screen over `library` and waits for its cards. */
async function renderLibrary(library: Library, overrides: Parameters<typeof fakeHub>[0] = {}) {
  window.hub = fakeHub({ ...overrides, library: { list: async () => library, ...overrides.library } })
  render(<LibraryScreen />)
  return screen.findByRole('article', { name: 'Server' })
}

describe('LibraryScreen', () => {
  it('shows one card per component with its versions, channel and history', async () => {
    const server = await renderLibrary(LIBRARY)

    expect(server.textContent).toContain('Installed1.0.0')
    expect(server.textContent).toContain('Available1.1.0')
    expect(server.textContent).toContain('1.0.0 installed')
    expect(within(server).getByRole('combobox', { name: 'Channel' })).toHaveProperty('value', 'stable')
    expect(within(server).queryByRole('button', { name: /Install|Uninstall/ })).toBeNull()

    const hub = screen.getByRole('article', { name: 'Stylistic Hub' })
    expect(hub.textContent).toContain('Installed0.9.0')
    expect(within(hub).queryByRole('button', { name: /Install|Uninstall/ })).toBeNull()

    const addin = screen.getByRole('article', { name: 'word-addin' })
    expect(within(addin).getByRole('combobox', { name: 'Channel' })).toHaveProperty('value', 'beta')
    expect(within(addin).getByRole('button', { name: 'Uninstall' })).toBeTruthy()

    const glossary = screen.getByRole('article', { name: 'glossary' })
    expect(glossary.textContent).toContain('InstalledNot installed')
    expect(within(glossary).queryByRole('combobox')).toBeNull()
    expect(within(glossary).getByRole('button', { name: 'Install' })).toBeTruthy()
    expect(screen.queryByText(/is being downloaded/)).toBeNull()
  })

  it('installs a module, then reads the library again', async () => {
    const install = vi.fn(async () => undefined)
    const list = vi.fn(async () => LIBRARY)
    await renderLibrary(LIBRARY, { library: { install, list } })

    fireEvent.click(
      within(screen.getByRole('article', { name: 'glossary' })).getByRole('button', { name: 'Install' })
    )

    await waitFor(() => expect(install).toHaveBeenCalledWith('glossary'))
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  })

  it('uninstalls a module, or cancels its request', async () => {
    const uninstall = vi.fn(async () => undefined)
    const requested = { ...LIBRARY, components: [card('word-addin', 'module', { requested: true })] }
    window.hub = fakeHub({ library: { list: async () => requested, uninstall } })
    render(<LibraryScreen />)
    const addin = await screen.findByRole('article', { name: 'word-addin' })
    expect(addin.textContent).toContain('InstalledInstall requested')

    fireEvent.click(within(addin).getByRole('button', { name: 'Uninstall' }))

    await waitFor(() => expect(uninstall).toHaveBeenCalledWith('word-addin'))
  })

  it('sets a channel through the Server screen’s call: `hub` for the hub, the id otherwise', async () => {
    const setChannel = vi.fn(async () => undefined)
    await renderLibrary(LIBRARY, { server: { setChannel } })

    const channel = (name: string) =>
      within(screen.getByRole('article', { name })).getByRole('combobox', { name: 'Channel' })
    fireEvent.change(channel('Stylistic Hub'), { target: { value: 'beta' } })
    fireEvent.change(channel('word-addin'), { target: { value: 'stable' } })

    await waitFor(() => expect(setChannel).toHaveBeenCalledTimes(2))
    expect(setChannel).toHaveBeenNthCalledWith(1, 'hub', 'beta')
    expect(setChannel).toHaveBeenNthCalledWith(2, 'word-addin', 'stable')
  })

  it('checks the catalog on request, and reads the library again after each check', async () => {
    const check = vi.fn(async () => undefined)
    let checked: () => void = () => undefined
    const list = vi.fn(async () => LIBRARY)
    await renderLibrary(LIBRARY, {
      library: { check, list, onChecked: (listener) => ((checked = listener), () => undefined) }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(check).toHaveBeenCalledOnce())
    act(() => checked())

    await waitFor(() => expect(list).toHaveBeenCalledTimes(3))
  })

  it('says why an action failed', async () => {
    const install = vi.fn(async () => Promise.reject(new Error('glossary is not a module')))
    await renderLibrary(LIBRARY, { library: { install } })

    fireEvent.click(
      within(screen.getByRole('article', { name: 'glossary' })).getByRole('button', { name: 'Install' })
    )

    expect(await screen.findByText('glossary is not a module')).toBeTruthy()
  })

  it('on the first run, says the server is being downloaded and offers the catalog’s modules', async () => {
    await renderLibrary({
      firstRun: true,
      catalog: true,
      components: [
        card('server', 'server'),
        card('stylistic-hub', 'hub', { installed: '0.9.0' }),
        card('glossary', 'module', { available: '0.1.0' })
      ]
    })

    expect(screen.getByText(/The server is being downloaded/)).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Server' }).textContent).toContain('InstalledNot installed')
    expect(
      within(screen.getByRole('article', { name: 'glossary' })).getByRole('button', { name: 'Install' })
    ).toBeTruthy()
  })

  it('says when no catalog check has succeeded yet', async () => {
    const server = await renderLibrary({
      ...LIBRARY,
      catalog: false,
      components: [card('server', 'server', { installed: '1.0.0' })]
    })

    expect(server.textContent).toContain('AvailableNot checked yet')
    expect(screen.getByText(/No catalog check has succeeded/)).toBeTruthy()
  })
})
