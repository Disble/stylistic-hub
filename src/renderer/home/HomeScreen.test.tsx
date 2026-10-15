// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeHub } from '../fake-hub'
import { HomeScreen } from './HomeScreen'

afterEach(cleanup)

describe('HomeScreen', () => {
  it('lists the next steps with what is already done', async () => {
    window.hub = fakeHub({
      provider: {
        list: async () => [{ id: 'openai-codex', name: 'ChatGPT', configured: true, authMethods: [] }]
      }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    expect(await screen.findByText('2 of 3 done')).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Local server running · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'AI provider connected · done' })).toBeTruthy()
    expect(screen.getByRole('listitem', { name: 'Stylistic added to Word · to do' })).toBeTruthy()
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
    expect(server.textContent).toContain('Running')

    fireEvent.click(screen.getByRole('button', { name: 'Add to Word' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage server' }))

    expect(onOpen.mock.calls).toEqual([['word'], ['server']])
  })

  it('shows Word as added once the certificate is trusted and the add-in registered', async () => {
    window.hub = fakeHub({
      word: { status: async () => ({ available: true, caTrusted: true, addinRegistered: true }) }
    })
    render(<HomeScreen onOpen={() => undefined} />)

    expect(await screen.findByRole('button', { name: 'Manage Word' })).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Word add-in' }).textContent).toContain('Added')
    expect(screen.getByRole('article', { name: 'Word add-in' }).textContent).not.toContain('Version')
  })
})
