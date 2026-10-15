// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    window.hub = { versions: { electron: '44.7.2', node: '24.21.0' } }
  })

  afterEach(cleanup)

  it('names the hub and shows the runtime versions the preload exposes', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: 'Stylistic Hub' })).toBeTruthy()
    expect(screen.getByText('Electron 44.7.2 · Node 24.21.0')).toBeTruthy()
  })
})
