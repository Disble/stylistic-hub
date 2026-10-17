import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalModel } from './local-model'

/** Fresh Pi folder for each test. */
let dir: string
/** Pi's `models.json` inside it. */
let modelsFile: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'local-model-'))
  modelsFile = join(dir, 'models.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A server answering the OpenAI-compatible model list with these ids. */
function serverWith(ids: string[]) {
  return vi.fn(async () => Response.json({ object: 'list', data: ids.map((id) => ({ id })) }))
}

describe('createLocalModel', () => {
  it('lists the server’s models and writes them to Pi’s models.json as the local provider', async () => {
    const fetch = serverWith(['qwen3:8b', 'llama3.3'])
    const local = createLocalModel({ modelsFile, fetch })

    const connected = await local.connect('http://localhost:11434/v1/')

    expect(fetch).toHaveBeenCalledWith('http://localhost:11434/v1/models', expect.anything())
    expect(connected).toEqual({ baseUrl: 'http://localhost:11434/v1', models: ['qwen3:8b', 'llama3.3'] })
    expect(JSON.parse(readFileSync(modelsFile, 'utf8'))).toEqual({
      providers: {
        local: {
          name: 'Local model',
          baseUrl: 'http://localhost:11434/v1',
          api: 'openai-completions',
          apiKey: 'local',
          models: [{ id: 'qwen3:8b' }, { id: 'llama3.3' }]
        }
      }
    })
    expect(await local.get()).toEqual(connected)
  })

  it('keeps the other entries of models.json', async () => {
    writeFileSync(
      modelsFile,
      JSON.stringify({ providers: { other: { baseUrl: 'x' } }, modelOverrides: { a: 1 } })
    )
    const local = createLocalModel({ modelsFile, fetch: serverWith(['m']) })

    await local.connect('http://localhost:1234/v1')
    await local.disconnect()

    expect(JSON.parse(readFileSync(modelsFile, 'utf8'))).toEqual({
      providers: { other: { baseUrl: 'x' } },
      modelOverrides: { a: 1 }
    })
  })

  it('removes the local provider on disconnect', async () => {
    const local = createLocalModel({ modelsFile, fetch: serverWith(['m']) })
    await local.connect('http://localhost:1234/v1')

    await local.disconnect()

    expect(await local.get()).toBeUndefined()
  })

  it('has no local model before one is connected', async () => {
    expect(await createLocalModel({ modelsFile, fetch: serverWith([]) }).get()).toBeUndefined()
    expect(existsSync(modelsFile)).toBe(false)
  })

  it.each([
    ['not a URL', 'Enter the server address, for example http://localhost:11434/v1'],
    ['ftp://localhost/v1', 'Enter the server address, for example http://localhost:11434/v1']
  ])('refuses the address %s', async (address, message) => {
    const fetch = serverWith(['m'])

    await expect(createLocalModel({ modelsFile, fetch }).connect(address)).rejects.toThrow(message)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('says when the server cannot be reached, and writes nothing', async () => {
    const fetch = vi.fn(async () => Promise.reject(new TypeError('fetch failed')))

    await expect(
      createLocalModel({ modelsFile, fetch }).connect('http://localhost:11434/v1')
    ).rejects.toThrow('Could not reach http://localhost:11434/v1. Is the model server running?')
    expect(existsSync(modelsFile)).toBe(false)
  })

  it('says when the server answers with an error', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 404 }))

    await expect(createLocalModel({ modelsFile, fetch }).connect('http://localhost:11434')).rejects.toThrow(
      'http://localhost:11434/models answered 404. Check the address; OpenAI-compatible servers usually end in /v1.'
    )
  })

  it('says when the server lists no models', async () => {
    await expect(
      createLocalModel({ modelsFile, fetch: serverWith([]) }).connect('http://localhost:11434/v1')
    ).rejects.toThrow('The server lists no models. Download or load a model first.')
  })
})
