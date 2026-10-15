import { Badge, MessageBar, MessageBarBody, Text, Title2 } from '@fluentui/react-components'
import type { ServerStatus } from '../../shared/bridge'
import { useServerStatus } from '../hub-state'

/** How each server state reads, and its badge color. */
export const SERVER_STATE = {
  starting: { label: 'Starting', color: 'informative' },
  running: { label: 'Running', color: 'success' },
  restarting: { label: 'Restarting', color: 'danger' }
} as const satisfies Record<ServerStatus['state'], { label: string; color: string }>

/** Explains unexpected exits, so a crash loop is visible instead of the hub failing silently. */
function crashMessage({ state, crashes, lastExitCode, restartInMs }: ServerStatus): string {
  const times = crashes === 1 ? '1 time' : `${crashes} times`
  const restart =
    state === 'restarting' && restartInMs !== undefined ? ` Restarting in ${restartInMs / 1000} s.` : ''
  return `The server stopped unexpectedly ${times} since the hub opened (last exit code ${lastExitCode}).${restart}`
}

/** The local server: its version, where it serves and whether it keeps running. */
export function ServerScreen() {
  const status = useServerStatus()
  if (!status) return null
  const { label, color } = SERVER_STATE[status.state]

  return (
    <section style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Title2 as="h2">Local server</Title2>
        <Badge appearance="tint" color={color}>
          {label}
        </Badge>
      </div>
      <Text as="p" block>{`Version ${status.version}`}</Text>
      <Text as="p" block font="monospace">
        {status.address}
      </Text>
      {status.crashes > 0 && (
        <MessageBar intent={status.state === 'restarting' ? 'error' : 'warning'} role="alert">
          <MessageBarBody>{crashMessage(status)}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  )
}
