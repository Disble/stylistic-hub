import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { LocalModel } from '../shared/bridge'

/** Pi's provider id for the local model server. */
const LOCAL_PROVIDER = 'local'

/** Shown for an address that is not an http(s) URL. */
const ADDRESS_HINT = 'Enter the server address, for example http://localhost:11434/v1'

/** The part of Pi's `models.json` the hub reads and writes; other keys are kept as they are. */
interface ModelsFile {
  providers?: Record<string, { baseUrl?: string; models?: { id: string }[] } & Record<string, unknown>>
  [key: string]: unknown
}

/**
 * A local, OpenAI-compatible model server (Ollama, LM Studio, vLLM…) as Pi's documented `models.json`
 * entry: the hub only lists the server's models and writes the entry, and Pi does the rest (S1).
 */
export function createLocalModel({
  modelsFile,
  fetch
}: {
  modelsFile: string
  fetch: (url: string, init: RequestInit) => Promise<Response>
}) {
  const read = async (): Promise<ModelsFile> =>
    existsSync(modelsFile) ? (JSON.parse(await readFile(modelsFile, 'utf8')) as ModelsFile) : {}

  const write = (content: ModelsFile) => writeFile(modelsFile, `${JSON.stringify(content, null, 2)}\n`)

  /** The model ids the server lists at `<baseUrl>/models`, the OpenAI-compatible list. */
  const listModels = async (baseUrl: string): Promise<string[]> => {
    const url = `${baseUrl}/models`
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    } catch {
      throw new Error(`Could not reach ${baseUrl}. Is the model server running?`)
    }
    if (!response.ok)
      throw new Error(
        `${url} answered ${response.status}. Check the address; OpenAI-compatible servers usually end in /v1.`
      )
    const { data } = (await response.json()) as { data?: { id?: unknown }[] }
    const ids = (data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string')
    if (!ids.length) throw new Error('The server lists no models. Download or load a model first.')
    return ids
  }

  return {
    async get(): Promise<LocalModel | undefined> {
      const entry = (await read()).providers?.[LOCAL_PROVIDER]
      if (!entry?.baseUrl) return undefined
      return { baseUrl: entry.baseUrl, models: (entry.models ?? []).map((m) => m.id) }
    },

    async connect(address: string): Promise<LocalModel> {
      let url: URL
      try {
        url = new URL(address.trim())
      } catch {
        throw new Error(ADDRESS_HINT)
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(ADDRESS_HINT)
      const baseUrl = url.href.replace(/\/+$/, '')
      const [models, content] = await Promise.all([listModels(baseUrl), read()])
      content.providers = {
        ...content.providers,
        [LOCAL_PROVIDER]: {
          name: 'Local model',
          baseUrl,
          api: 'openai-completions',
          // Pi needs a key to count the provider as signed in; local servers ignore it.
          apiKey: 'local',
          models: models.map((id) => ({ id }))
        }
      }
      await write(content)
      return { baseUrl, models }
    },

    async disconnect(): Promise<void> {
      const content = await read()
      if (!content.providers?.[LOCAL_PROVIDER]) return
      delete content.providers[LOCAL_PROVIDER]
      if (!Object.keys(content.providers).length) delete content.providers
      await write(content)
    }
  }
}
