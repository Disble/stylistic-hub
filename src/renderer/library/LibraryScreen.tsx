import {
  Button,
  Field,
  makeStyles,
  MessageBar,
  MessageBarBody,
  Select,
  Spinner,
  tokens
} from '@fluentui/react-components'
import { ArrowSync20Regular } from '@fluentui/react-icons'
import { useCallback, useEffect, useState } from 'react'
import type { Channel, HistoryLine, HubUpdateStatus, Library, LibraryComponent } from '../../shared/bridge'
import { errorMessage, WORD_MODULE_ID } from '../hub-state'
import { Details, Page, Section, Surface } from '../ui/layout'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '12px' },
  cardTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  status: { margin: 0, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2 },
  ready: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' },
  history: {
    margin: 0,
    paddingLeft: '16px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2
  }
})

/** Plain names and one-line descriptions; a module the hub does not know keeps its catalog id and no description. */
const NAMES: Record<string, { title: string; description: string }> = {
  server: { title: 'Server', description: 'Runs the analysis on this computer.' },
  hub: {
    title: 'Stylistic Hub',
    description: 'This app. It installs the other components and keeps them up to date.'
  },
  [WORD_MODULE_ID]: { title: 'Stylistic for Word', description: 'The Stylistic pane in Word.' }
}

/** The card name of a component: the server and the hub by kind, a module by id. */
function nameOf({ id, kind }: LibraryComponent): { title: string; description?: string } {
  return NAMES[kind === 'module' ? id : kind] ?? { title: id }
}

/** The channels a card lists, with their labels. */
const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'stable', label: 'Stable' },
  { value: 'beta', label: 'Beta' }
]

/** What is installed: the version, a pending request, or nothing. */
function installedText({ installed, requested }: LibraryComponent): string {
  if (installed) return installed
  return requested ? 'Install requested' : 'Not installed'
}

/** Why something happened, in plain words, for the reasons the update engine records; any other reason as it is. */
const REASONS: Record<string, string> = {
  health_check_failed: 'it did not start correctly',
  network: 'the download failed',
  invalid_document: 'its files did not pass the signature check',
  binding_mismatch: 'its files did not match the catalog',
  revoked_key: 'its signing key was revoked',
  no_catalog: 'the catalog could not be read',
  no_hub_entry: 'the catalog does not list this hub',
  crash_loop: 'it kept crashing',
  bad_signature: 'its signature did not verify',
  unknown_key: 'it was signed by a key the hub does not know',
  wrong_scope: 'its signing key may not publish it',
  sha256_mismatch: 'the download was damaged',
  size_mismatch: 'the download was incomplete',
  bad_zip: 'the download was damaged',
  symlink: 'its package was refused as unsafe',
  reserved_name: 'its package was refused as unsafe',
  too_large: 'its package was too large',
  already_installed: 'it is already installed',
  not_newer: 'it is not newer than the installed version',
  already_served: 'that version is already running'
}

/** A code the hub does not describe, as words. */
const words = (code: string): string => code.replaceAll('_', ' ')

/** `: why` when there is a reason, else nothing. */
const because = (reason: string | null): string => (reason ? `: ${REASONS[reason] ?? words(reason)}` : '')

/** What happened, in plain words, for each outcome the update engine records. */
const HAPPENED: Record<HistoryLine['outcome'], (line: HistoryLine, version: string) => string> = {
  installed: ({ from, to }, version) =>
    from && to ? `Updated from ${from} to ${to}` : `Installed ${version}`,
  switched: ({ from, to }) => `Switched from ${from ?? '?'} to ${to ?? '?'}`,
  failed: ({ reason }, version) => `Could not install ${version}${because(reason)}`,
  marked_bad: ({ reason }, version) => `The hub will not install ${version} again${because(reason)}`,
  disabled: ({ reason }, version) =>
    reason === 'uninstalled' ? `Uninstalled ${version}` : `Turned off ${version}${because(reason)}`
}

/** What happened, in plain words; an outcome a newer hub wrote, as words, instead of breaking the screen. */
function whatHappened(line: HistoryLine): string {
  const version = line.to ?? line.from ?? ''
  const happened = HAPPENED[line.outcome] as (typeof HAPPENED)[keyof typeof HAPPENED] | undefined
  return happened ? happened(line, version) : `${version}: ${words(String(line.outcome))}`
}

/** One history line: the date, then what happened. */
function historyText(line: HistoryLine): string {
  return `${line.time.slice(0, 10)} · ${whatHappened(line)}`
}

/** The hub's own update on its card: each step as it happens, the restart once it is ready, or why it failed. */
function HubUpdate({ update, run }: { update: HubUpdateStatus; run: (action: () => Promise<void>) => void }) {
  const styles = useStyles()
  switch (update.state) {
    case 'up-to-date':
      return <p className={styles.status}>Up to date: no newer hub on this channel.</p>
    case 'downloading':
      return (
        <Spinner size="tiny" labelPosition="after" label={`Downloading and verifying ${update.version}…`} />
      )
    case 'ready':
      return (
        <div className={styles.ready}>
          <p className={styles.status}>{update.version} is downloaded and verified.</p>
          <Button appearance="primary" onClick={() => run(window.hub.library.restart)}>
            Restart and update to {update.version}
          </Button>
        </div>
      )
    case 'failed':
      return (
        <MessageBar intent="warning">
          <MessageBarBody>
            Could not update to {update.version} ({update.reason}). The next check tries again.
          </MessageBarBody>
        </MessageBar>
      )
  }
}

/** When the last check ended and how, or that none has succeeded yet. */
function checkText(library: Library): string | undefined {
  const { lastCheck } = library
  if (!lastCheck) return library.catalog ? undefined : 'No catalog check has succeeded since the hub opened.'
  const time = new Date(lastCheck.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return lastCheck.result === 'ok'
    ? `Last checked at ${time}.`
    : `The check at ${time} failed: ${lastCheck.result}.`
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
  const { id, kind, offers, channel, history } = component
  const inState = kind !== 'module' || Boolean(component.installed) || component.requested
  const offerText = (on: Channel) => (catalog ? (offers[on] ?? 'None offered') : 'Not checked yet')
  const { title, description } = nameOf(component)
  return (
    <Surface as="article" label={title}>
      <h3 className={styles.cardTitle}>{title}</h3>
      {description && <p className={styles.status}>{description}</p>}
      <Details
        items={[
          { term: 'Installed', value: installedText(component), mono: true },
          ...CHANNELS.map(({ value, label }) => ({
            term: `${label} channel`,
            value: offerText(value),
            mono: true
          }))
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
            {CHANNELS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {component.update && <HubUpdate update={component.update} run={run} />}
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
      meta={checkText(library)}
      actions={
        <Button
          icon={library.checking ? <Spinner size="tiny" /> : <ArrowSync20Regular />}
          disabled={Boolean(library.checking)}
          onClick={() => run(window.hub.library.check)}
        >
          {library.checking ? 'Checking…' : 'Check now'}
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
