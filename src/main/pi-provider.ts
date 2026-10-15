import { join } from 'node:path'
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent'
import type { ModelSummary, ProviderSummary } from '../shared/bridge'
import type { LoginAuthType, LoginInteraction } from '../shared/login/login'

/** What the Provider screen can do with Pi: sign in and out, and choose the model. */
export interface PiProvider {
  listProviders(): Promise<ProviderSummary[]>
  /** Models of the signed-in providers. */
  listModels(): Promise<ModelSummary[]>
  /** The chosen model, while its provider is still signed in. */
  getModel(): Promise<ModelSummary | undefined>
  setModel(provider: string, modelId: string): Promise<ModelSummary>
  /** Runs one of Pi's own login flows; Pi stores the credential. */
  login(providerId: string, type: LoginAuthType, interaction: LoginInteraction): Promise<void>
  logout(providerId: string): Promise<void>
}

/**
 * Pi over the hub's own directory (`userData/pi`): credentials in `auth.json`, the chosen model in
 * Pi's `settings.json`. Providers and sign-in methods are exactly what Pi offers (S5).
 */
export async function createPiProvider(agentDir: string): Promise<PiProvider> {
  const runtime = await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
    allowModelNetwork: false
  })
  const settings = SettingsManager.create(agentDir, agentDir)

  const listModels = async (): Promise<ModelSummary[]> =>
    (await runtime.getAvailable()).map((m) => ({ provider: m.provider, id: m.id, name: m.name }))

  return {
    async listProviders() {
      // Availability refreshes the runtime's view of credentials another process wrote.
      await runtime.getAvailable()
      return runtime
        .getProviders()
        .map((p) => ({
          id: p.id,
          name: p.name,
          configured: runtime.getProviderAuthStatus(p.id).configured,
          authMethods: [
            ...(p.auth.oauth
              ? [{ type: 'oauth' as const, label: p.auth.oauth.loginLabel ?? p.auth.oauth.name }]
              : []),
            ...(p.auth.apiKey?.login ? [{ type: 'api_key' as const, label: p.auth.apiKey.name }] : [])
          ]
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    listModels,

    async getModel() {
      const provider = settings.getDefaultProvider()
      const id = settings.getDefaultModel()
      return (await listModels()).find((m) => m.provider === provider && m.id === id)
    },

    async setModel(provider, modelId) {
      const model = (await listModels()).find((m) => m.provider === provider && m.id === modelId)
      if (!model)
        throw new Error(`Model ${provider}/${modelId} is not available; sign in to its provider first`)
      settings.setDefaultModelAndProvider(provider, modelId)
      await settings.flush()
      return model
    },

    async login(providerId, type, interaction) {
      await runtime.login(providerId, type, interaction, {
        getDeviceId: () => settings.getOrCreateDeviceId()
      })
    },

    logout: (providerId) => runtime.logout(providerId)
  }
}
