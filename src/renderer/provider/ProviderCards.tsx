import {
  Badge,
  Button,
  Field,
  Input,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  Text,
  tokens
} from '@fluentui/react-components'
import { Desktop20Regular, Key20Regular, PersonCircle20Regular, type FluentIcon } from '@fluentui/react-icons'
import { useState, type ReactNode } from 'react'
import type { LocalModel, ModelSummary, ProviderSummary } from '../../shared/bridge'
import { errorMessage } from '../hub-state'
import { Surface } from '../ui/layout'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  head: { display: 'flex', alignItems: 'center', gap: '10px' },
  icon: {
    width: '32px',
    height: '32px',
    flex: '0 0 32px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1
  },
  title: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  muted: { margin: 0, color: tokens.colorNeutralForeground2 },
  rows: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minHeight: '44px',
    borderTop: `1px solid ${tokens.colorNeutralStroke3}`
  },
  rowName: { flex: 1, minWidth: 0 },
  actions: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: 'auto' },
  model: { minWidth: '280px' }
})

/** Value of a model option: provider ids never contain a slash, model ids may. */
function modelValue(model: ModelSummary): string {
  return `${model.provider}/${model.id}`
}

/** The model the corrections use, chosen among the signed-in providers' models, grouped by provider. */
export function ModelPicker({
  models,
  model,
  providers,
  onChoose
}: {
  models: ModelSummary[]
  model: ModelSummary | undefined
  providers: ProviderSummary[]
  onChoose(provider: string, modelId: string): void
}) {
  const styles = useStyles()
  if (models.length === 0)
    return <Text className={styles.muted}>Sign in to a provider to choose a model.</Text>

  const choose = (value: string) => {
    const slash = value.indexOf('/')
    onChoose(value.slice(0, slash), value.slice(slash + 1))
  }
  const groups = [...new Set(models.map((m) => m.provider))]
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id
  return (
    <Field label="Model for corrections" className={styles.model}>
      <Select value={model ? modelValue(model) : ''} onChange={(_e, data) => choose(data.value)}>
        {!model && <option value="">Choose a model</option>}
        {groups.map((provider) => (
          <optgroup key={provider} label={nameOf(provider)}>
            {models
              .filter((m) => m.provider === provider)
              .map((m) => (
                <option key={modelValue(m)} value={modelValue(m)}>
                  {m.name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>
    </Field>
  )
}

/** A connection option on the canvas: an icon, a title, a line on what it does, and its controls. */
function OptionCard({
  title,
  icon: Icon,
  body,
  children
}: {
  title: string
  icon: FluentIcon
  body: string
  children: ReactNode
}) {
  const styles = useStyles()
  return (
    <Surface as="article" label={title}>
      <div className={styles.head}>
        <span className={styles.icon}>
          <Icon aria-hidden />
        </span>
        <h2 className={styles.title}>{title}</h2>
      </div>
      <p className={styles.muted}>{body}</p>
      {children}
    </Surface>
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
  const styles = useStyles()
  return (
    <OptionCard
      title="Sign in with a subscription"
      icon={PersonCircle20Regular}
      body="Uses your plan. Sign-in opens in your browser, and the hub keeps the session fresh."
    >
      <ul className={styles.rows}>
        {providers.map((p) => (
          <li key={p.id} aria-label={p.name} className={styles.row}>
            <Text className={styles.rowName}>{p.name}</Text>
            {p.configured ? (
              <>
                <Badge appearance="tint" color="success">
                  Connected
                </Badge>
                <Button size="small" appearance="subtle" onClick={() => onSignOut(p)}>
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
    </OptionCard>
  )
}

/** Providers with an API-key sign-in, picked from a list. */
export function ApiKeyCard({ providers, onSignIn, onSignOut }: SignInProps) {
  const styles = useStyles()
  const [chosenId, setChosenId] = useState('')
  const chosen = providers.find((p) => p.id === chosenId)
  return (
    <OptionCard
      title="Use an API key"
      icon={Key20Regular}
      body="Pay per use with a key from your provider’s console. Pi asks for the key and stores it on this computer."
    >
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
      <div className={styles.actions}>
        <Button appearance="primary" disabled={!chosen} onClick={() => chosen && onSignIn(chosen)}>
          Sign in with an API key
        </Button>
        {chosen?.configured && <Button onClick={() => onSignOut(chosen)}>Sign out of {chosen.name}</Button>}
      </div>
    </OptionCard>
  )
}

/** A model server on this computer (Ollama, LM Studio…), added to Pi through `models.json`. */
export function LocalModelCard({
  local,
  onConnect,
  onDisconnect
}: {
  local: LocalModel | undefined
  onConnect(baseUrl: string): Promise<void>
  onDisconnect(): Promise<void>
}) {
  const styles = useStyles()
  const [address, setAddress] = useState('http://localhost:11434/v1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const run = (action: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    action()
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(false))
  }

  const count = local && (local.models.length === 1 ? '1 model' : `${local.models.length} models`)
  return (
    <OptionCard
      title="Local model"
      icon={Desktop20Regular}
      body="Ollama, LM Studio or any OpenAI-compatible server on this computer. The model must support tool calls."
    >
      {local ? (
        <>
          <div className={styles.head}>
            <Text size={200} font="monospace" className={styles.rowName}>
              {`${local.baseUrl} · ${count}`}
            </Text>
            <Badge appearance="tint" color="success">
              Connected
            </Badge>
          </div>
          <Text size={200} className={styles.muted}>
            Its models are listed under Model for corrections.
          </Text>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={() => run(onDisconnect)}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <>
          <Field label="Server address">
            <Input type="url" value={address} onChange={(_e, data) => setAddress(data.value)} />
          </Field>
          <div className={styles.actions}>
            <Button
              appearance="primary"
              disabled={busy}
              {...(busy && { icon: <Spinner size="tiny" /> })}
              onClick={() => run(() => onConnect(address))}
            >
              Connect
            </Button>
          </div>
        </>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </OptionCard>
  )
}
