// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WordStatus } from '../../shared/bridge'
import { fakeHub } from '../fake-hub'
import { WordScreen } from './WordScreen'

afterEach(cleanup)

/** Word before anything was added. */
const NEW: WordStatus = { available: true, caTrusted: false, addinRegistered: false, version: '1.0.0.0' }
/** Word with the certificate trusted and the add-in registered. */
const READY: WordStatus = { available: true, caTrusted: true, addinRegistered: true, version: '1.0.0.0' }

/** Shows the Word screen over a hub whose Word status is `status`. */
function renderWith(status: WordStatus, word: Partial<typeof window.hub.word> = {}) {
  const current = { value: status }
  window.hub = fakeHub({ word: { status: async () => current.value, ...word } })
  render(<WordScreen />)
  return current
}

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

  it('explains that the add-in is not bundled and offers nothing to click', async () => {
    renderWith({ available: false, caTrusted: false, addinRegistered: false })

    expect(await screen.findByText(/not bundled with this hub/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to Word' })).toBeNull()
    expect(within(document.body).queryByRole('list')).toBeNull()
  })
})
