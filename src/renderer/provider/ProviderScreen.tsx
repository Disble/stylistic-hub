import { MessageBar, MessageBarBody, Text, Title2 } from '@fluentui/react-components'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelSummary, ProviderSummary } from '../../shared/bridge'
import type { LoginAuthType } from '../../shared/login/login'
import { LoginDialog } from './LoginDialog'
import { loginStarted, reduceLogin, type LoginState } from './login-state'
import { ApiKeyCard, ModelCard, SubscriptionCard } from './ProviderCards'

/** True when the provider offers this sign-in method. */
function offers(provider: ProviderSummary, type: LoginAuthType): boolean {
  return provider.authMethods.some((m) => m.type === type)
}

/** Sign in to the providers Pi offers and choose the model the corrections use. */
export function ProviderScreen() {
  const api = window.hub.provider
  const [data, setData] = useState<{ providers: ProviderSummary[]; models: ModelSummary[] }>({
    providers: [],
    models: []
  })
  const [model, setModel] = useState<ModelSummary | undefined>()
  const [reloads, setReloads] = useState(0)
  const [login, setLogin] = useState<LoginState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const loginId = useRef<string | undefined>(undefined)
  const refresh = useCallback(() => setReloads((n) => n + 1), [])

  useEffect(() => {
    let live = true
    void Promise.all([api.list(), api.listModels(), api.getModel()]).then(([providers, models, chosen]) => {
      if (!live) return
      setData({ providers, models })
      setModel(chosen)
    })
    return () => {
      live = false
    }
  }, [api, reloads])

  useEffect(
    () =>
      api.onLoginEvent((event) => {
        if (event.loginId !== loginId.current) return
        // A finished or cancelled sign-in closes the dialog; a failure stays open to show why.
        if (event.type === 'login-done' || (event.type === 'login-failed' && event.cancelled)) {
          loginId.current = undefined
          setLogin(undefined)
          refresh()
          return
        }
        setLogin((current) => current && reduceLogin(current, event))
      }),
    [api, refresh]
  )

  /** Runs a user action, showing why it failed instead of losing the rejection. */
  const run = (action: () => Promise<void>) => {
    setError(undefined)
    action().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const startLogin = (provider: ProviderSummary, type: LoginAuthType) =>
    run(async () => {
      const id = await api.startLogin(provider.id, type)
      loginId.current = id
      setLogin(loginStarted(id, provider.id, provider.name))
    })

  const logout = (provider: ProviderSummary) =>
    run(async () => {
      await api.logout(provider.id)
      refresh()
    })

  const closeLogin = () => {
    loginId.current = undefined
    setLogin(undefined)
  }

  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <header>
        <Title2 as="h2">AI provider</Title2>
        <Text as="p" block>
          Stylistic uses your own AI account. Credentials stay on this computer.
        </Text>
      </header>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <ModelCard
        models={data.models}
        model={model}
        onChoose={(provider, modelId) => run(async () => setModel(await api.setModel(provider, modelId)))}
      />
      <SubscriptionCard
        providers={data.providers.filter((p) => offers(p, 'oauth'))}
        onSignIn={(p) => startLogin(p, 'oauth')}
        onSignOut={logout}
      />
      <ApiKeyCard
        providers={data.providers.filter((p) => offers(p, 'api_key'))}
        onSignIn={(p) => startLogin(p, 'api_key')}
        onSignOut={logout}
      />

      {login && (
        <LoginDialog
          state={login}
          onAnswer={(promptId, value) => void api.answerPrompt(login.loginId, promptId, value)}
          onCancel={() => void api.cancelLogin(login.loginId)}
          onClose={closeLogin}
        />
      )}
    </section>
  )
}
