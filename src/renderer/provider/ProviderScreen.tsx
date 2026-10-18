import { makeStyles, MessageBar, MessageBarBody, Text, tokens } from '@fluentui/react-components'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalModel, ModelSummary, ProviderSummary } from '../../shared/bridge'
import type { LoginAuthType } from '../../shared/login/login'
import { LoginDialog } from './LoginDialog'
import { loginStarted, reduceLogin, type LoginState } from './login-state'
import { Page } from '../ui/layout'
import { errorMessage } from '../hub-state'
import { ApiKeyCard, LocalModelCard, ModelPicker, SubscriptionCard } from './ProviderCards'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  options: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '12px',
    alignItems: 'stretch'
  },
  privacy: { margin: 0, color: tokens.colorNeutralForeground2 }
})

/** True when the provider offers this sign-in method. */
function offers(provider: ProviderSummary, type: LoginAuthType): boolean {
  return provider.authMethods.some((m) => m.type === type)
}

/** Sign in to the providers Pi offers and choose the model the corrections use. */
export function ProviderScreen() {
  const styles = useStyles()
  const api = window.hub.provider
  const [data, setData] = useState<{ providers: ProviderSummary[]; models: ModelSummary[] }>({
    providers: [],
    models: []
  })
  const [model, setModel] = useState<ModelSummary | undefined>()
  const [local, setLocal] = useState<LocalModel | undefined>()
  const [reloads, setReloads] = useState(0)
  const [login, setLogin] = useState<LoginState | undefined>()
  const [error, setError] = useState<string | undefined>()
  const loginId = useRef<string | undefined>(undefined)
  const refresh = useCallback(() => setReloads((n) => n + 1), [])

  useEffect(() => {
    let live = true
    void Promise.all([api.list(), api.listModels(), api.getModel(), api.getLocal()]).then(
      ([providers, models, chosen, server]) => {
        if (!live) return
        setData({ providers, models })
        setModel(chosen)
        setLocal(server)
      }
    )
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
    action().catch((reason: unknown) => setError(errorMessage(reason)))
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
    <Page
      title="AI provider"
      description="Stylistic uses your own AI account. Credentials stay on this computer, managed by Pi."
      actions={
        <ModelPicker
          models={data.models}
          model={model}
          providers={data.providers}
          onChoose={(provider, modelId) => run(async () => setModel(await api.setModel(provider, modelId)))}
        />
      }
    >
      {/* The privacy notice (odd/tasks/readiness.md S1): shown here, where the provider is chosen, and nowhere else. */}
      <Text as="p" className={styles.privacy}>
        The text you analyze and the document’s style profile go only to the provider you choose here; the hub
        sends nothing else anywhere (no telemetry).
      </Text>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <section aria-label="Connection options" className={styles.options}>
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
        <LocalModelCard
          local={local}
          onConnect={async (baseUrl) => {
            setLocal(await api.connectLocal(baseUrl))
            refresh()
          }}
          onDisconnect={async () => {
            await api.disconnectLocal()
            setLocal(undefined)
            refresh()
          }}
        />
      </section>

      {login && (
        <LoginDialog
          state={login}
          onAnswer={(promptId, value) => void api.answerPrompt(login.loginId, promptId, value)}
          onCancel={() => void api.cancelLogin(login.loginId)}
          onClose={closeLogin}
        />
      )}
    </Page>
  )
}
