import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPiProvider } from './pi-provider'

/** Fresh Pi directory for each test. */
let agentDir: string

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'hub-pi-'))
})

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true })
})

/** Stores an API key the way a finished Pi sign-in does, so models become available offline. */
function signInWithKey(provider: string): void {
  writeFileSync(
    join(agentDir, 'auth.json'),
    JSON.stringify({ [provider]: { type: 'api_key', key: 'sk-test' } })
  )
}

describe('createPiProvider', () => {
  it('lists every Pi provider with the sign-in methods Pi offers, signed out at first', async () => {
    const provider = await createPiProvider(agentDir)

    const providers = await provider.listProviders()
    const anthropic = providers.find((p) => p.id === 'anthropic')

    expect(providers.length).toBeGreaterThan(10)
    expect(anthropic?.configured).toBe(false)
    expect(anthropic?.authMethods.map((m) => m.type)).toEqual(['oauth', 'api_key'])
    expect(providers.map((p) => p.name)).toEqual(
      [...providers.map((p) => p.name)].sort((a, b) => a.localeCompare(b))
    )
  })

  it('offers no models before any sign-in', async () => {
    const provider = await createPiProvider(agentDir)

    expect(await provider.listModels()).toEqual([])
    expect(await provider.getModel()).toBeUndefined()
  })

  it('lists the signed-in provider as configured and its models as available', async () => {
    signInWithKey('anthropic')
    const provider = await createPiProvider(agentDir)

    const providers = await provider.listProviders()
    const models = await provider.listModels()

    expect(providers.find((p) => p.id === 'anthropic')?.configured).toBe(true)
    expect(models.length).toBeGreaterThan(0)
    expect(models.every((m) => m.provider === 'anthropic')).toBe(true)
  })

  it('stores the chosen model in Pi settings and reads it back after a restart', async () => {
    signInWithKey('anthropic')
    const first = await createPiProvider(agentDir)
    const [model] = await first.listModels()
    if (!model) throw new Error('expected a model')

    await first.setModel(model.provider, model.id)
    const second = await createPiProvider(agentDir)

    expect(await second.getModel()).toEqual(model)
    expect(JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8'))).toMatchObject({
      defaultProvider: model.provider,
      defaultModel: model.id
    })
  })

  it('refuses a model that is not available', async () => {
    const provider = await createPiProvider(agentDir)

    await expect(provider.setModel('anthropic', 'claude-nonexistent')).rejects.toThrow(/not available/)
  })

  it('forgets the chosen model once its provider is signed out', async () => {
    signInWithKey('anthropic')
    const provider = await createPiProvider(agentDir)
    const [model] = await provider.listModels()
    if (!model) throw new Error('expected a model')
    await provider.setModel(model.provider, model.id)

    await provider.logout('anthropic')

    expect(await provider.getModel()).toBeUndefined()
    expect((await provider.listProviders()).find((p) => p.id === 'anthropic')?.configured).toBe(false)
  })

  it('offers a local model written to models.json once it reloads', async () => {
    const provider = await createPiProvider(agentDir)
    writeFileSync(
      join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          local: {
            baseUrl: 'http://localhost:11434/v1',
            api: 'openai-completions',
            apiKey: 'local',
            models: [{ id: 'qwen3:8b' }]
          }
        }
      })
    )

    await provider.reload()

    expect(await provider.listModels()).toContainEqual({
      provider: 'local',
      id: 'qwen3:8b',
      name: 'qwen3:8b'
    })
    expect((await provider.listProviders()).find((p) => p.id === 'local')?.configured).toBe(true)
  })
})
