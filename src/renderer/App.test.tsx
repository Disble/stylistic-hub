// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { fakeHub } from './fake-hub'

describe('App', () => {
  beforeEach(() => {
    window.hub = fakeHub()
  })

  afterEach(cleanup)

  it('names the hub, shows the runtime versions and opens on Home', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: 'Welcome to Stylistic' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Stylistic Hub' })).toBeTruthy()
    expect(screen.getByText('Electron 44.7.2 · Node 24.21.0')).toBeTruthy()
  })

  it.each([
    ['Word', 'Stylistic for Word'],
    ['Server', 'Local server'],
    ['Provider', 'AI provider']
  ])('opens the %s screen from the navigation', async (tab, heading) => {
    render(<App />)

    fireEvent.click(screen.getByRole('tab', { name: tab }))

    expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeTruthy()
  })

  it('opens a component screen from its Home card', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Manage server' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Local server' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Server', selected: true })).toBeTruthy()
  })
})
