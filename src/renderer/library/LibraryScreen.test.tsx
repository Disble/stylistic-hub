// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryLine, HubUpdateStatus, Library, LibraryComponent } from '../../shared/bridge'
import { fakeHub } from '../fake-hub'
import { WORD_MODULE_ID } from '../hub-state'
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
    offers: { stable: null, beta: null },
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
      offers: { stable: '1.1.0', beta: '1.2.0-beta.1' },
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
    expect(server.textContent).toContain('Stable channel1.1.0')
    expect(server.textContent).toContain('Beta channel1.2.0-beta.1')
    expect(server.textContent).toContain('2026-10-18 · Installed 1.0.0')
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

  /** LIBRARY with the hub card's update at `update`. */
  const withUpdate = (update: HubUpdateStatus): Library => ({
    ...LIBRARY,
    components: LIBRARY.components.map((c) => (c.kind === 'hub' ? { ...c, update } : c))
  })
  const hubCard = () => screen.getByRole('article', { name: 'Stylistic Hub' })

  it('shows the version each channel would install, or that it offers none or was not checked', async () => {
    const glossary = (await renderLibrary(LIBRARY), screen.getByRole('article', { name: 'glossary' }))
    expect(glossary.textContent).toContain('Stable channelNone offered')
    expect(glossary.textContent).toContain('Beta channelNone offered')
    cleanup()

    const server = await renderLibrary({ ...LIBRARY, catalog: false })
    expect(server.textContent).toContain('Stable channelNot checked yet')
    expect(server.textContent).toContain('Beta channelNot checked yet')
  })

  it('names each component in plain words and says what it is', async () => {
    const word = card(WORD_MODULE_ID, 'module', { installed: '1.2.0' })
    await renderLibrary({ ...LIBRARY, components: [...LIBRARY.components, word] })

    expect(screen.getByRole('article', { name: 'Server' }).textContent).toContain(
      'Runs the analysis on this computer.'
    )
    expect(screen.getByRole('article', { name: 'Stylistic Hub' }).textContent).toContain(
      'This app. It installs the other components and keeps them up to date.'
    )
    const addin = screen.getByRole('article', { name: 'Stylistic for Word' })
    expect(addin.textContent).toContain('The Stylistic pane in Word.')
    expect(screen.queryByText(WORD_MODULE_ID)).toBeNull()
    expect(screen.getByRole('article', { name: 'glossary' })).toBeTruthy()
  })

  it('tells the history in plain words', async () => {
    const at = (day: string) => `2026-11-${day}T10:00:00.000Z`
    const history: LibraryComponent['history'] = [
      { time: at('25'), from: '1.4.0-beta.1', to: '1.3.2', outcome: 'switched', reason: null },
      { time: at('24'), from: '1.1.0', to: null, outcome: 'marked_bad', reason: 'health_check_failed' },
      { time: at('23'), from: '1.0.0', to: '1.1.0', outcome: 'installed', reason: null },
      { time: at('22'), from: null, to: '1.2.0', outcome: 'failed', reason: 'network' },
      { time: at('21'), from: '0.9.0', to: null, outcome: 'disabled', reason: 'revoked_key' },
      { time: at('20'), from: '0.8.0', to: null, outcome: 'disabled', reason: 'uninstalled' },
      { time: at('19'), from: null, to: '0.7.0', outcome: 'failed', reason: 'something_new' },
      { time: at('18'), from: '0.6.0', to: null, outcome: 'marked_bad', reason: 'crash_loop' },
      { time: at('17'), from: null, to: '0.5.0', outcome: 'failed', reason: 'bad_signature' },
      { time: at('16'), from: null, to: '0.4.0', outcome: 'later' as HistoryLine['outcome'], reason: null },
      {
        time: at('15'),
        from: null,
        to: null,
        outcome: 'rolled_back' as HistoryLine['outcome'],
        reason: null
      },
      { time: at('14'), from: null, to: '0.3.0', outcome: 'failed', reason: 'wrong_role' },
      {
        time: at('13'),
        from: '0.3.0',
        to: '0.2.0',
        outcome: 'switched',
        reason: 'writes_since_upgrade_lost: backup-12.db'
      }
    ]
    await renderLibrary({ ...LIBRARY, components: [card('server', 'server', { history })] })

    const lines = within(screen.getByRole('list', { name: 'Server history' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(lines).toEqual([
      '2026-11-25 · Switched from 1.4.0-beta.1 to 1.3.2',
      '2026-11-24 · The hub will not install 1.1.0 again: it did not start correctly',
      '2026-11-23 · Updated from 1.0.0 to 1.1.0',
      '2026-11-22 · Could not install 1.2.0: the download failed',
      '2026-11-21 · Turned off 0.9.0: its signing key was revoked',
      '2026-11-20 · Uninstalled 0.8.0',
      '2026-11-19 · Could not install 0.7.0: something new',
      '2026-11-18 · The hub will not install 0.6.0 again: it kept crashing',
      '2026-11-17 · Could not install 0.5.0: its signature did not verify',
      '2026-11-16 · 0.4.0: later',
      '2026-11-15 · rolled back',
      '2026-11-14 · Could not install 0.3.0: it was signed by a key that may not sign it',
      '2026-11-13 · Switched from 0.3.0 to 0.2.0: the changes made since the upgrade were lost, and the hub restored a backup (backup-12.db)'
    ])
  })

  it('offers a restart only on a hub card with a downloaded update, and restarts on click', async () => {
    const restart = vi.fn(async () => undefined)
    await renderLibrary(LIBRARY)
    expect(screen.queryByRole('button', { name: /Restart/ })).toBeNull()
    cleanup()

    await renderLibrary(withUpdate({ state: 'ready', version: '1.2.0-beta.1' }), { library: { restart } })
    expect(hubCard().textContent).toContain('1.2.0-beta.1 is downloaded and verified.')
    fireEvent.click(within(hubCard()).getByRole('button', { name: 'Restart and update to 1.2.0-beta.1' }))

    await waitFor(() => expect(restart).toHaveBeenCalledOnce())
    expect(screen.getAllByRole('button', { name: /Restart/ })).toHaveLength(1)
  })

  it('shows each step of the hub’s update on its card: up to date, downloading, failed', async () => {
    await renderLibrary(withUpdate({ state: 'up-to-date' }))
    expect(hubCard().textContent).toContain('Up to date: no newer hub on this channel.')
    cleanup()

    await renderLibrary(withUpdate({ state: 'downloading', version: '1.2.0-beta.2' }))
    expect(within(hubCard()).getByText('Downloading and verifying 1.2.0-beta.2…')).toBeTruthy()
    expect(within(hubCard()).queryByRole('button', { name: /Restart/ })).toBeNull()
    cleanup()

    await renderLibrary(withUpdate({ state: 'failed', version: '1.2.0-beta.2', reason: 'network' }))
    expect(hubCard().textContent).toContain(
      'Could not update to 1.2.0-beta.2 (network). The next check tries again.'
    )
  })

  it('says a check is running, and when the last one ended and how', async () => {
    await renderLibrary({ ...LIBRARY, checking: true })
    const button = screen.getByRole('button', { name: 'Checking…' })
    expect(button.hasAttribute('disabled')).toBe(true)
    cleanup()

    const time = '2026-10-22T15:54:00.000Z'
    const at = new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    await renderLibrary({ ...LIBRARY, lastCheck: { time, result: 'ok' } })
    expect(screen.getByText(`Last checked at ${at}.`)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Check now' })).toBeTruthy()
    cleanup()

    await renderLibrary({ ...LIBRARY, lastCheck: { time, result: 'expired' } })
    expect(screen.getByText(`The check at ${at} failed: expired.`)).toBeTruthy()
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

    expect(server.textContent).toContain('Stable channelNot checked yet')
    expect(screen.getByText(/No catalog check has succeeded/)).toBeTruthy()
  })
})
