import {
  Button,
  Field,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Select,
  tokens
} from '@fluentui/react-components'
import { ArrowSync20Regular } from '@fluentui/react-icons'
import { useCallback, useEffect, useState } from 'react'
import type { Channel, HistoryLine, Library, LibraryComponent } from '../../shared/bridge'
import { errorMessage } from '../hub-state'
import { Details, Page, Section, Surface } from '../ui/layout'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' },
  cardTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  history: {
    margin: 0,
    paddingLeft: '16px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2
  }
})

/** The card title of a component. */
function titleOf({ id, kind }: LibraryComponent): string {
  if (kind === 'server') return 'Server'
  return kind === 'hub' ? 'Stylistic Hub' : id
}

/** What is installed: the version, a pending request, or nothing. */
function installedText({ installed, requested }: LibraryComponent): string {
  if (installed) return installed
  return requested ? 'Install requested' : 'Not installed'
}

/** One history line: date, version, what happened and why. */
function historyText({ time, from, to, outcome, reason }: HistoryLine): string {
  const why = reason ? ` (${reason})` : ''
  return `${time.slice(0, 10)} ${to ?? from ?? ''} ${outcome.replace('_', ' ')}${why}`
}

/** One component: versions, channel, the actions the engine supports for it, and its latest history. */
function ComponentCard({
  component,
  catalog,
  run
}: {
  component: LibraryComponent
  catalog: boolean
  run: (action: () => Promise<void>) => void
}) {
  const styles = useStyles()
  const { id, kind, available, channel, history } = component
  const inState = kind !== 'module' || Boolean(component.installed) || component.requested
  const availableText = catalog ? (available ?? 'None offered') : 'Not checked yet'
  const title = titleOf(component)
  return (
    <Surface as="article" label={title}>
      <h3 className={styles.cardTitle}>{title}</h3>
      <Details
        items={[
          { term: 'Installed', value: installedText(component), mono: true },
          { term: 'Available', value: availableText, mono: true }
        ]}
      />
      {inState && (
        <Field label="Channel">
          <Select
            value={channel}
            onChange={(_event, data) =>
              run(() => window.hub.server.setChannel(kind === 'hub' ? 'hub' : id, data.value as Channel))
            }
          >
            <option value="stable">Stable</option>
            <option value="beta">Beta</option>
          </Select>
        </Field>
      )}
      {kind === 'module' && (
        <div>
          {inState ? (
            <Button onClick={() => run(() => window.hub.library.uninstall(id))}>Uninstall</Button>
          ) : (
            <Button appearance="primary" onClick={() => run(() => window.hub.library.install(id))}>
              Install
            </Button>
          )}
        </div>
      )}
      {history.length > 0 && (
        <ul className={styles.history} aria-label={`${title} history`}>
          {history.map((line) => (
            <li key={`${line.time}-${line.outcome}-${line.to}`}>{historyText(line)}</li>
          ))}
        </ul>
      )}
    </Surface>
  )
}

/** The library (odd/tasks/module-library.md S5): every component the hub installs, kept current after each check. */
export function LibraryScreen() {
  const styles = useStyles()
  const [library, setLibrary] = useState<Library | undefined>()
  const [error, setError] = useState<string | undefined>()

  const reload = useCallback(() => {
    window.hub.library.list().then(setLibrary, (reason: unknown) => setError(errorMessage(reason)))
  }, [])
  useEffect(() => {
    reload()
    return window.hub.library.onChecked(reload)
  }, [reload])

  /** Runs one action, then reads the library again; shows why it failed. */
  const run = useCallback(
    (action: () => Promise<void>) => {
      setError(undefined)
      action().then(reload, (reason: unknown) => setError(errorMessage(reason)))
    },
    [reload]
  )

  if (!library) return null
  return (
    <Page
      title="Library"
      description="The server, the hub and the modules this hub installs and updates from the signed catalog."
      meta={library.catalog ? undefined : 'No catalog check has succeeded since the hub opened.'}
      actions={
        <Button icon={<ArrowSync20Regular />} onClick={() => run(window.hub.library.check)}>
          Check now
        </Button>
      }
    >
      {library.firstRun && (
        <MessageBar intent="info">
          <MessageBarBody>
            The server is being downloaded: the hub installs it at every catalog check. Pick the modules to
            install with it.
          </MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Section title="Components">
        <div className={styles.cards}>
          {library.components.map((component) => (
            <ComponentCard key={component.id} component={component} catalog={library.catalog} run={run} />
          ))}
        </div>
      </Section>
    </Page>
  )
}
