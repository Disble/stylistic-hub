import { Badge, Button, Card, Field, Select, Subtitle2, Text } from '@fluentui/react-components'
import { useState } from 'react'
import type { ModelSummary, ProviderSummary } from '../../shared/bridge'

/** Value of a model option: provider ids never contain a slash, model ids may. */
function modelValue(model: ModelSummary): string {
  return `${model.provider}/${model.id}`
}

/** The model the corrections use, chosen among the signed-in providers' models. */
export function ModelCard({
  models,
  model,
  onChoose
}: {
  models: ModelSummary[]
  model: ModelSummary | undefined
  onChoose(provider: string, modelId: string): void
}) {
  const choose = (value: string) => {
    const slash = value.indexOf('/')
    onChoose(value.slice(0, slash), value.slice(slash + 1))
  }
  return (
    <Card>
      {models.length === 0 ? (
        <Text>Sign in to a provider to choose a model.</Text>
      ) : (
        <Field label="Model for corrections">
          <Select value={model ? modelValue(model) : ''} onChange={(_e, data) => choose(data.value)}>
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
  )
}

/** What the sign-in cards do with a provider. */
interface SignInProps {
  providers: ProviderSummary[]
  onSignIn(provider: ProviderSummary): void
  onSignOut(provider: ProviderSummary): void
}

/** Providers with a subscription (OAuth) sign-in, one row each. */
export function SubscriptionCard({ providers, onSignIn, onSignOut }: SignInProps) {
  return (
    <Card>
      <Subtitle2 as="h3">Sign in with a subscription</Subtitle2>
      <Text>Uses your plan. Sign-in opens in your browser.</Text>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {providers.map((p) => (
          <li key={p.id} aria-label={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1 }}>{p.name}</Text>
            {p.configured ? (
              <>
                <Badge appearance="tint" color="success">
                  Connected
                </Badge>
                <Button size="small" onClick={() => onSignOut(p)}>
                  Sign out
                </Button>
              </>
            ) : (
              <Button size="small" onClick={() => onSignIn(p)}>
                Sign in
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** Providers with an API-key sign-in, picked from a list. */
export function ApiKeyCard({ providers, onSignIn, onSignOut }: SignInProps) {
  const [chosenId, setChosenId] = useState('')
  const chosen = providers.find((p) => p.id === chosenId)
  return (
    <Card>
      <Subtitle2 as="h3">Use an API key</Subtitle2>
      <Field label="Provider">
        <Select value={chosenId} onChange={(_e, data) => setChosenId(data.value)}>
          <option value="">Choose a provider</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.configured ? `${p.name} (connected)` : p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button appearance="primary" disabled={!chosen} onClick={() => chosen && onSignIn(chosen)}>
          Sign in with an API key
        </Button>
        {chosen?.configured && <Button onClick={() => onSignOut(chosen)}>Sign out of {chosen.name}</Button>}
      </div>
    </Card>
  )
}
