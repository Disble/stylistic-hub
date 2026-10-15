import { join } from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent'

/**
 * The backend's view of Pi over the hub's directory, shared with the main process: the runtime
 * that sends requests, and the model chosen on the Provider screen. Pi's file lock keeps the two
 * processes from racing on `auth.json` (token refresh, sign-in).
 */
export async function createChosenModel(agentDir: string) {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
    allowModelNetwork: false
  })
  const settings = SettingsManager.create(agentDir, agentDir)

  /** The chosen model while its provider is signed in; re-read on every call, since main changes it. */
  const getModel = async (): Promise<Model<Api> | undefined> => {
    await settings.reload()
    const provider = settings.getDefaultProvider()
    const id = settings.getDefaultModel()
    if (!provider || !id) return undefined
    return (await runtime.getAvailable(provider)).find((m) => m.id === id)
  }

  return { runtime, getModel }
}
