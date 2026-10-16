// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WordStatus } from '../../shared/bridge'
import { fakeHub } from '../fake-hub'
import { WordScreen } from './WordScreen'

afterEach(cleanup)

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
    const current = renderWith(
      { available: true, caTrusted: false, addinRegistered: false, version: '1.0.0.0' },
      { connect }
    )
    expect(await screen.findByText('Version 1.0.0.0')).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Trust this computer’s certificate · to do' })).toBeTruthy()

    current.value = { available: true, caTrusted: true, addinRegistered: true, version: '1.0.0.0' }
    fireEvent.click(screen.getByRole('button', { name: 'Add to Word' }))

    expect(await screen.findByRole('listitem', { name: 'Add Stylistic to Word · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Trust this computer’s certificate · done' })).toBeTruthy()
    expect(connect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Add to Word' })).toBeNull()
  })

  it('shows why adding failed, for example a declined Windows prompt', async () => {
    renderWith(
      { available: true, caTrusted: false, addinRegistered: false },
      { connect: async () => Promise.reject(new Error('Windows did not trust the hub certificate')) }
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Add to Word' }))

    expect(await screen.findByText('Windows did not trust the hub certificate')).toBeTruthy()
  })

  it('removes Stylistic from Word', async () => {
    const disconnect = vi.fn(async () => undefined)
    const current = renderWith({ available: true, caTrusted: true, addinRegistered: true }, { disconnect })

    current.value = { available: true, caTrusted: true, addinRegistered: false }
    fireEvent.click(await screen.findByRole('button', { name: 'Remove from Word' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Add to Word' })).toBeTruthy())
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('opens Word with Stylistic once the add-in is added', async () => {
    const open = vi.fn(async () => undefined)
    renderWith({ available: true, caTrusted: true, addinRegistered: true }, { open })

    fireEvent.click(await screen.findByRole('button', { name: 'Open Word' }))

    await waitFor(() => expect(open).toHaveBeenCalledOnce())
  })

  it('offers Open Word only after the add-in is added', async () => {
    renderWith({ available: true, caTrusted: true, addinRegistered: false })

    await screen.findByRole('button', { name: 'Add to Word' })
    expect(screen.queryByRole('button', { name: 'Open Word' })).toBeNull()
  })

  it('shows why Word did not open', async () => {
    renderWith(
      { available: true, caTrusted: true, addinRegistered: true },
      { open: async () => Promise.reject(new Error('Could not open Word: No application is associated')) }
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open Word' }))

    expect(await screen.findByText('Could not open Word: No application is associated')).toBeTruthy()
  })

  it('explains that the add-in is not bundled and offers nothing to click', async () => {
    renderWith({ available: false, caTrusted: false, addinRegistered: false })

    expect(await screen.findByText(/not bundled with this hub/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to Word' })).toBeNull()
  })
})
