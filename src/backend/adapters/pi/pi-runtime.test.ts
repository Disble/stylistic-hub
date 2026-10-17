import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createChosenModel } from './pi-runtime'

/** Fresh Pi directory for each test. */
let agentDir: string

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'hub-pi-backend-'))
})

afterEach(() => {
  rmSync(agentDir, { recursive: true, force: true })
})

/** Writes what the Provider screen leaves behind: a credential and the chosen model. */
function choose(provider: string, modelId: string, signedIn = true): void {
  if (signedIn) {
    writeFileSync(
      join(agentDir, 'auth.json'),
      JSON.stringify({ [provider]: { type: 'api_key', key: 'sk-test' } })
    )
  }
  writeFileSync(
    join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: provider, defaultModel: modelId })
  )
}

describe('createChosenModel', () => {
  it('has no model before one is chosen', async () => {
    const { getModel } = await createChosenModel(agentDir)

    expect(await getModel()).toBeUndefined()
  })

  it('returns the model chosen on the Provider screen, even after the backend started', async () => {
    const { getModel, runtime } = await createChosenModel(agentDir)
    const [first] = runtime.getModels('anthropic')
    if (!first) throw new Error('expected an Anthropic model')

    choose('anthropic', first.id)

    expect(await getModel()).toMatchObject({ provider: 'anthropic', id: first.id })
  })

  it('has no model when the chosen provider is signed out', async () => {
    const { getModel, runtime } = await createChosenModel(agentDir)
    const [first] = runtime.getModels('anthropic')
    if (!first) throw new Error('expected an Anthropic model')

    choose('anthropic', first.id, false)

    expect(await getModel()).toBeUndefined()
  })

  it('finds a local model the hub added to models.json after the backend started', async () => {
    const { getModel } = await createChosenModel(agentDir)
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
    choose('local', 'qwen3:8b', false)

    expect(await getModel()).toMatchObject({ provider: 'local', id: 'qwen3:8b' })
  })
})
