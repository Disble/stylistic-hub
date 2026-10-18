import {
  Badge,
  Button,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Text,
  tokens,
  type BadgeProps
} from '@fluentui/react-components'
import { ArrowClockwise20Regular, ArrowDownload20Regular, FolderOpen20Regular } from '@fluentui/react-icons'
import { useState } from 'react'
import type { ServerStatus } from '../../shared/bridge'
import { errorMessage, useProviderState, useServerStatus, type Screen } from '../hub-state'
import { Details, Page, Section, Surface } from '../ui/layout'

/** How each server state reads, and its badge color. */
export const SERVER_STATE = {
  starting: { label: 'Starting', color: 'informative' },
  running: { label: 'Running', color: 'success' },
  restarting: { label: 'Restarting', color: 'danger' },
  'rolled-back': { label: 'Rolled back', color: 'warning' }
} as const satisfies Record<ServerStatus['state'], { label: string; color: NonNullable<BadgeProps['color']> }>

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  services: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' },
  serviceTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' },
  serviceTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  mono: { margin: 0, fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  muted: { margin: 0, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  columns: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' },
  provider: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: '12px' },
  providerText: { flex: '1 1 160px', display: 'flex', flexDirection: 'column', minWidth: 0 }
})

/** Explains unexpected exits, so a crash loop is visible instead of the hub failing silently. */
function crashMessage({ state, crashes, lastExitCode, restartInMs }: ServerStatus): string {
  const times = crashes === 1 ? '1 time' : `${crashes} times`
  const restart =
    state === 'restarting' && restartInMs !== undefined ? ` Restarting in ${restartInMs / 1000} s.` : ''
  return `The server stopped unexpectedly ${times} since the hub opened (last exit code ${lastExitCode}).${restart}`
}

/** Unexpected exits, and why the hub rolled back or stopped the server. */
function ServerAlerts({ status }: { status: ServerStatus }) {
  return (
    <>
      {status.crashes > 0 && (
        <MessageBar intent={status.state === 'restarting' ? 'error' : 'warning'} role="alert">
          <MessageBarBody>{crashMessage(status)}</MessageBarBody>
        </MessageBar>
      )}
      {status.reason && (
        <MessageBar intent="warning">
          <MessageBarBody>{status.reason}</MessageBarBody>
        </MessageBar>
      )}
    </>
  )
}

/** One service the local server provides, with its state. */
function Service({
  title,
  state,
  color,
  lines
}: {
  title: string
  state: string
  color: NonNullable<BadgeProps['color']>
  lines: [address: string, detail: string]
}) {
  const styles = useStyles()
  return (
    <Surface as="article" label={title}>
      <div className={styles.serviceTop}>
        <h3 className={styles.serviceTitle}>{title}</h3>
        <Badge appearance="tint" color={color}>
          {state}
        </Badge>
      </div>
      <div>
        <p className={styles.mono}>{lines[0]}</p>
        <p className={styles.muted}>{lines[1]}</p>
      </div>
    </Surface>
  )
}

/** The local server: its services, the AI provider it calls, and what to do when something is wrong. */
export function ServerScreen({ onOpen }: { onOpen: (screen: Screen) => void }) {
  const styles = useStyles()
  const status = useServerStatus()
  const provider = useProviderState()
  const [error, setError] = useState<string | undefined>()
  /** Where the last diagnostics bundle was saved. */
  const [saved, setSaved] = useState<string | undefined>()
  const { electron, node } = window.hub.versions

  if (!status) return null
  const { label, color } = SERVER_STATE[status.state]
  const connected = provider?.connected ?? []
  const chosen = connected.find((p) => p.id === provider?.model?.provider)

  /** Runs one action, showing why it failed. */
  const run = (action: () => Promise<void>) => {
    setError(undefined)
    action().catch((reason: unknown) => setError(errorMessage(reason)))
  }

  return (
    <Page
      title="Local server"
      description="Runs the analysis engine for Word on this computer. It starts with the hub, and the hub starts with Windows."
      meta={`Version ${status.version}`}
      actions={
        <>
          <Button icon={<FolderOpen20Regular />} onClick={() => run(window.hub.server.openLogs)}>
            Open logs folder
          </Button>
          <Button
            icon={<ArrowDownload20Regular />}
            onClick={() =>
              run(async () => {
                setSaved(undefined)
                setSaved(await window.hub.server.exportDiagnostics())
              })
            }
          >
            Export diagnostics
          </Button>
          <Button
            icon={<ArrowClockwise20Regular />}
            disabled={status.state === 'starting'}
            onClick={() => run(window.hub.server.restart)}
          >
            Restart
          </Button>
        </>
      }
    >
      <ServerAlerts status={status} />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {saved && (
        <MessageBar intent="success">
          <MessageBarBody>
            Diagnostics saved to {saved}. It includes the logs, which may hold excerpts of analyzed text;
            check it before attaching it to a report.
          </MessageBarBody>
        </MessageBar>
      )}

      <Section title="Services">
        <div className={styles.services}>
          <Service
            title="Analysis API"
            state={label}
            color={color}
            lines={[`${status.address}/api`, 'Corrections and feedback for the Word add-in']}
          />
          <Service
            title="Database"
            state={status.state === 'restarting' ? 'Unavailable' : 'Ready'}
            color={status.state === 'restarting' ? 'danger' : 'success'}
            lines={[
              'stylistic.db',
              'Each document’s style profile and your correction preferences, in the app folder'
            ]}
          />
          <Service
            title="Word access"
            state="Secured"
            color="success"
            lines={['Hub token · this computer only', 'No accounts: one hub per Windows user']}
          />
        </div>
      </Section>

      <div className={styles.columns}>
        <Section title="AI provider" caption="Managed by Pi · credentials stay on this computer">
          <Surface className={styles.provider}>
            {provider?.model && chosen ? (
              <>
                <span className={styles.providerText}>
                  <Text weight="semibold">{chosen.name}</Text>
                  <Text size={200} font="monospace">
                    {provider.model.name}
                  </Text>
                </span>
                <Badge appearance="tint" color="success">
                  Connected
                </Badge>
                <Button onClick={() => onOpen('provider')}>Change provider</Button>
              </>
            ) : (
              <>
                <span className={styles.providerText}>
                  <Text weight="semibold">
                    {connected.length ? 'No model chosen' : 'No provider connected'}
                  </Text>
                  <Text size={200}>Corrections need a signed-in provider and a model.</Text>
                </span>
                <Button appearance="primary" onClick={() => onOpen('provider')}>
                  Connect a provider
                </Button>
              </>
            )}
          </Surface>
        </Section>

        <Section title="This computer">
          <Surface>
            <Details
              items={[
                { term: 'Runtime', value: `Electron ${electron} · Node ${node}`, mono: true },
                { term: 'Logs', value: 'server.log and word-session.log, in the logs folder' }
              ]}
            />
          </Surface>
        </Section>
      </div>
    </Page>
  )
}
