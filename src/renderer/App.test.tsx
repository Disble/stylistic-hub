// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { fakeHub } from './fake-hub'

describe('App', () => {
  beforeEach(() => {
    window.hub = fakeHub()
  })

  afterEach(cleanup)

  it('opens on Home, with the Stylistic logo and the main navigation', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome to Stylistic' })).toBeTruthy()
    const navigation = screen.getByRole('navigation', { name: 'Main' })
    expect(within(navigation).getByRole('img', { name: 'Stylistic' })).toBeTruthy()
    const tabs = within(navigation).getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    for (const [index, name] of ['Home', 'Word', 'Server', 'Provider', 'Library'].entries())
      expect(within(navigation).getByRole('tab', { name })).toBe(tabs[index])
    expect(screen.getByRole('tab', { name: 'Home', selected: true })).toBeTruthy()
  })

  it.each([
    ['Word', 'Stylistic for Word'],
    ['Server', 'Local server'],
    ['Provider', 'AI provider'],
    ['Library', 'Library']
  ])('opens the %s screen from the navigation', async (tab, heading) => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: tab }))

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy()
  })

  /** The grids of cards on the current screen: the ones that lay their columns out with `repeat()`. */
  const cardGrids = () =>
    [...document.querySelectorAll('main *')]
      .map((element) => getComputedStyle(element).gridTemplateColumns)
      .filter((columns) => columns.startsWith('repeat('))

  it.each([
    ['Home', 'Welcome to Stylistic'],
    ['Word', 'Stylistic for Word'],
    ['Server', 'Local server'],
    ['Provider', 'AI provider'],
    ['Library', 'Library']
  ])('lets the %s screen use the whole width of the window, with no empty columns', async (tab, heading) => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: tab }))
    await screen.findByRole('heading', { level: 1, name: heading })

    const content = document.querySelector('main')?.firstElementChild
    // No max width: unset ('' in happy-dom) or 'none'.
    expect(['', 'none']).toContain(content && getComputedStyle(content).maxWidth)
    await vi.waitFor(() => {
      for (const columns of cardGrids()) expect(columns).not.toContain('auto-fill')
    })
  })

  it('stretches the Home cards across the row instead of leaving empty columns', async () => {
    render(<App />)

    await screen.findByRole('heading', { level: 1, name: 'Welcome to Stylistic' })

    expect(cardGrids()).toContain('repeat(auto-fit, minmax(300px, 1fr))')
  })

  it('opens a component screen from its Home card', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Manage server' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Local server' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Server', selected: true })).toBeTruthy()
  })
})
