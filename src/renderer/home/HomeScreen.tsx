import { Badge, Button, makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components'
import {
  CheckmarkCircle20Filled,
  DocumentText24Regular,
  Server24Regular,
  Sparkle24Regular,
  type FluentIcon
} from '@fluentui/react-icons'
import type { ReactNode } from 'react'
import type { ServerStatus, WordStatus } from '../../shared/bridge'
import {
  providerReady,
  useProviderState,
  useServerStatus,
  useWordStatus,
  wordReady,
  type ProviderState,
  type Screen
} from '../hub-state'
import { SERVER_STATE } from '../server/ServerScreen'
import { StepList } from '../StepList'
import { Details, Page, Section, Surface, type Detail } from '../ui/layout'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  pill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: tokens.borderRadiusCircular,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200
  },
  dot: { width: '8px', height: '8px', borderRadius: '50%' },
  next: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '16px' },
  nextIcon: {
    width: '44px',
    height: '44px',
    flex: '0 0 44px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1
  },
  readyIcon: {
    backgroundColor: tokens.colorPaletteGreenBackground1,
    color: tokens.colorPaletteGreenForeground1
  },
  nextText: { flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
  nextTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  muted: { margin: 0, color: tokens.colorNeutralForeground2 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' },
  cardIcon: {
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForegroundOnBrand
  },
  wordIcon: { backgroundColor: '#2b579a' },
  serverIcon: { backgroundColor: '#7c3aed' },
  cardTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  caption: { color: tokens.colorNeutralForeground2 },
  cardActions: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto' }
})

/** The dot colors of the server pill, by state. */
const DOT = {
  starting: tokens.colorPaletteBlueBorderActive,
  running: tokens.colorPaletteGreenBackground3,
  restarting: tokens.colorPaletteRedBackground3,
  'rolled-back': tokens.colorPaletteYellowBackground3
} as const satisfies Record<ServerStatus['state'], string>

/** The server step's text while the server is not running yet. */
const SERVER_STEP = {
  starting: { title: 'The local server is starting', body: 'This takes a few seconds.' },
  restarting: {
    title: 'The local server stopped',
    body: 'The hub is starting it again. If it keeps stopping, the Server screen says why.'
  },
  'rolled-back': {
    title: 'A server update failed',
    body: 'The hub rolled it back or stopped the server. The Server screen says why.'
  }
} as const satisfies Record<Exclude<ServerStatus['state'], 'running'>, { title: string; body: string }>

/** What to do next, for each setup step that is not done yet. */
interface NextStep {
  title: string
  body: string
  action: string
  screen: Screen
  icon: FluentIcon
}

/** The first step that is not done, in the order the setup has to happen. */
function nextStep(server: ServerStatus, provider: ProviderState, word: boolean): NextStep | undefined {
  if (server.state !== 'running')
    return {
      ...SERVER_STEP[server.state],
      action: 'Open Server',
      screen: 'server',
      icon: Server24Regular
    } satisfies NextStep
  if (!provider.connected.length)
    return {
      title: 'Connect an AI provider',
      body: 'Stylistic uses your own AI account. Sign in with a subscription, paste an API key or use a local model.',
      action: 'Connect a provider',
      screen: 'provider',
      icon: Sparkle24Regular
    } satisfies NextStep
  if (!provider.model)
    return {
      title: 'Choose a model for corrections',
      body: 'You are signed in. Pick the model Stylistic writes its suggestions with.',
      action: 'Choose a model',
      screen: 'provider',
      icon: Sparkle24Regular
    } satisfies NextStep
  if (!word)
    return {
      title: 'Add Stylistic to Word',
      body: 'Windows asks once to trust the hub’s certificate. After that Stylistic shows up in your Word documents, with no restart.',
      action: 'Add to Word',
      screen: 'word',
      icon: DocumentText24Regular
    } satisfies NextStep
  return undefined
}

/** The server's state and address as a pill, in the screen's header. */
function ServerPill({ server }: { server: ServerStatus }) {
  const styles = useStyles()
  return (
    <span className={styles.pill}>
      <span aria-hidden className={styles.dot} style={{ backgroundColor: DOT[server.state] }} />
      {`Server ${SERVER_STATE[server.state].label.toLowerCase()} · ${server.address.replace(/^https?:\/\//, '')}`}
    </span>
  )
}

/** The next setup step as a call to action, or that Stylistic is ready once none is left. */
function NextStepCard({ next, onOpen }: { next: NextStep | undefined; onOpen: (screen: Screen) => void }) {
  const styles = useStyles()
  return (
    <section aria-label="Next step">
      <Surface className={styles.next}>
        <span className={mergeClasses(styles.nextIcon, !next && styles.readyIcon)}>
          {next ? <next.icon aria-hidden /> : <CheckmarkCircle20Filled aria-hidden />}
        </span>
        <span className={styles.nextText}>
          <h3 className={styles.nextTitle}>{next?.title ?? 'Stylistic is ready in Word'}</h3>
          <p className={styles.muted}>
            {next?.body ??
              'Open any document and find Stylistic on the Home tab. The hub stays in the tray and starts with Windows to keep it there.'}
          </p>
        </span>
        {next && (
          <Button appearance="primary" onClick={() => onOpen(next.screen)}>
            {next.action}
          </Button>
        )}
      </Surface>
    </section>
  )
}

/** One component on this computer: its state, what it is, its facts and the screen that manages it. */
function ComponentCard({
  title,
  caption,
  icon: Icon,
  iconClass,
  badge,
  details,
  action
}: {
  title: string
  caption: string
  icon: FluentIcon
  iconClass: string
  badge: ReactNode
  details: Detail[]
  action: ReactNode
}) {
  const styles = useStyles()
  return (
    <Surface as="article" label={title}>
      <div className={styles.cardTop}>
        <span className={mergeClasses(styles.cardIcon, iconClass)}>
          <Icon aria-hidden />
        </span>
        {badge}
      </div>
      <div>
        <h3 className={styles.cardTitle}>{title}</h3>
        <Text size={200} className={styles.caption}>
          {caption}
        </Text>
      </div>
      <Details items={details} />
      <div className={styles.cardActions}>{action}</div>
    </Surface>
  )
}

/** The Word add-in: whether it is added, its version, and the Word screen. */
function WordCard({
  word,
  server,
  onOpen
}: {
  word: WordStatus | undefined
  server: ServerStatus | undefined
  onOpen: (screen: Screen) => void
}) {
  const styles = useStyles()
  const inWord = wordReady(word)
  return (
    <ComponentCard
      title="Word add-in"
      caption="Word 2019 or later and Microsoft 365, on Windows"
      icon={DocumentText24Regular}
      iconClass={styles.wordIcon}
      badge={
        <Badge appearance="tint" color={inWord ? 'success' : 'warning'}>
          {inWord ? 'Added' : 'Not added'}
        </Badge>
      }
      details={[
        { term: 'Version', value: word?.version ?? '—', mono: true },
        { term: 'Task pane', value: server?.address ?? '—', mono: true }
      ]}
      action={
        <Button appearance={inWord ? 'secondary' : 'primary'} onClick={() => onOpen('word')}>
          {inWord ? 'Manage Word' : 'Add to Word'}
        </Button>
      }
    />
  )
}

/** The local server: its state, version and address, and the Server screen. */
function ServerCard({
  server,
  onOpen
}: {
  server: ServerStatus | undefined
  onOpen: (screen: Screen) => void
}) {
  const styles = useStyles()
  return (
    <ComponentCard
      title="Local server"
      caption="Analysis engine, AI provider and document memory"
      icon={Server24Regular}
      iconClass={styles.serverIcon}
      badge={
        server && (
          <Badge appearance="tint" color={SERVER_STATE[server.state].color}>
            {SERVER_STATE[server.state].label}
          </Badge>
        )
      }
      details={[
        { term: 'Version', value: server?.version ?? '—', mono: true },
        { term: 'Address', value: server ? `${server.address}/api` : '—', mono: true }
      ]}
      action={<Button onClick={() => onOpen('server')}>Manage server</Button>}
    />
  )
}

/** Where the user stands with the setup, what to do next, and the components on this computer. */
export function HomeScreen({ onOpen }: { onOpen: (screen: Screen) => void }) {
  const styles = useStyles()
  const server = useServerStatus()
  const provider = useProviderState()
  const { status: word } = useWordStatus()
  const inWord = wordReady(word)
  const withModel = providerReady(provider)

  const steps = [
    { label: 'Local server running', done: server?.state === 'running' },
    {
      label: withModel ? `AI provider connected · ${provider?.model?.name}` : 'AI provider connected',
      done: withModel
    },
    { label: 'Stylistic added to Word', done: inWord }
  ]

  return (
    <Page
      title="Welcome to Stylistic"
      description="Editorial suggestions inside Word, written as native Track Changes. Set up the hub once, then work from Word."
      actions={server && <ServerPill server={server} />}
    >
      <Section title="Next steps" caption={`${steps.filter((s) => s.done).length} of ${steps.length} done`}>
        {server && provider && word && (
          <NextStepCard next={nextStep(server, provider, inWord)} onOpen={onOpen} />
        )}
        <StepList steps={steps} />
      </Section>

      <Section title="Components" caption="What runs on this computer">
        <div className={styles.cards}>
          <WordCard word={word} server={server} onOpen={onOpen} />
          <ServerCard server={server} onOpen={onOpen} />
        </div>
      </Section>
    </Page>
  )
}
