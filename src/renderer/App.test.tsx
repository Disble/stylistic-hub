// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    const provider = {
      list: async () => [],
      listModels: async () => [],
      getModel: async () => undefined,
      setModel: async () => ({ provider: '', id: '', name: '' }),
      logout: async () => undefined,
      startLogin: async () => '',
      answerPrompt: async () => undefined,
      cancelLogin: async () => undefined,
      onLoginEvent: () => () => undefined
    }
    window.hub = { versions: { electron: '44.7.2', node: '24.21.0' }, provider }
  })

  afterEach(cleanup)

  it('names the hub, shows the runtime versions and the Provider screen', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { level: 2, name: 'AI provider' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Stylistic Hub' })).toBeTruthy()
    expect(screen.getByText('Electron 44.7.2 · Node 24.21.0')).toBeTruthy()
  })
})
