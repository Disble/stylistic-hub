// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

  it('opens a component screen from its Home card', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Manage server' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Local server' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Server', selected: true })).toBeTruthy()
  })
})
