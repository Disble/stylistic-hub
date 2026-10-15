import { Badge, Button, Card, Field, Select, Subtitle2, Text, Title2 } from '@fluentui/react-components'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelSummary, ProviderSummary } from '../../shared/bridge'
import type { LoginAuthType } from '../../shared/login/login'
import { LoginDialog } from './LoginDialog'
import { loginStarted, reduceLogin, type LoginState } from './login-state'

/** Value of a model option: provider ids never contain a slash, model ids may. */
function modelValue(model: ModelSummary): string {
  return `${model.provider}/${model.id}`
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
  const [keyProvider, setKeyProvider] = useState('')
  const [login, setLogin] = useState<LoginState | undefined>()
  const loginId = useRef<string | undefined>(undefined)
  const { providers, models } = data
  const refresh = useCallback(() => setReloads((n) => n + 1), [])

  useEffect(() => {
    let live = true
    void Promise.all([api.list(), api.listModels(), api.getModel()]).then(
      ([nextProviders, nextModels, nextModel]) => {
        if (!live) return
        setData({ providers: nextProviders, models: nextModels })
        setModel(nextModel)
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

  const startLogin = async (provider: ProviderSummary, type: LoginAuthType) => {
    const id = await api.startLogin(provider.id, type)
    loginId.current = id
    setLogin(loginStarted(id, provider.id, provider.name))
  }

  const chooseModel = async (value: string) => {
    const slash = value.indexOf('/')
    setModel(await api.setModel(value.slice(0, slash), value.slice(slash + 1)))
  }

  const subscriptions = providers.filter((p) => p.authMethods.some((m) => m.type === 'oauth'))
  const keyProviders = providers.filter((p) => p.authMethods.some((m) => m.type === 'api_key'))
  const chosenKeyProvider = keyProviders.find((p) => p.id === keyProvider)

  return (
    <section style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
      <header>
        <Title2 as="h2">AI provider</Title2>
        <Text as="p" block>
          Stylistic uses your own AI account. Credentials stay on this computer.
        </Text>
      </header>

      <Card>
        {models.length === 0 ? (
          <Text>Sign in to a provider to choose a model.</Text>
        ) : (
          <Field label="Model for corrections">
            <Select
              value={model ? modelValue(model) : ''}
              onChange={(_e, data) => void chooseModel(data.value)}
            >
              {!model && <option value="">Choose a model</option>}
              {models.map((m) => (
                <option key={modelValue(m)} value={modelValue(m)}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </Card>

      <Card>
        <Subtitle2 as="h3">Sign in with a subscription</Subtitle2>
        <Text>Uses your plan. Sign-in opens in your browser.</Text>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {subscriptions.map((p) => (
            <li key={p.id} aria-label={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1 }}>{p.name}</Text>
              {p.configured ? (
                <>
                  <Badge appearance="tint" color="success">
                    Connected
                  </Badge>
                  <Button size="small" onClick={() => void api.logout(p.id).then(refresh)}>
                    Sign out
                  </Button>
                </>
              ) : (
                <Button size="small" onClick={() => void startLogin(p, 'oauth')}>
                  Sign in
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <Subtitle2 as="h3">Use an API key</Subtitle2>
        <Field label="Provider">
          <Select value={keyProvider} onChange={(_e, data) => setKeyProvider(data.value)}>
            <option value="">Choose a provider</option>
            {keyProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.configured ? `${p.name} (connected)` : p.name}
              </option>
            ))}
          </Select>
        </Field>
        <div>
          <Button
            appearance="primary"
            disabled={!chosenKeyProvider}
            onClick={() => chosenKeyProvider && void startLogin(chosenKeyProvider, 'api_key')}
          >
            Sign in with an API key
          </Button>
        </div>
      </Card>

      {login && (
        <LoginDialog
          state={login}
          onAnswer={(promptId, value) => void api.answerPrompt(login.loginId, promptId, value)}
          onCancel={() => void api.cancelLogin(login.loginId)}
          onClose={() => {
            loginId.current = undefined
            setLogin(undefined)
          }}
        />
      )}
    </section>
  )
}
