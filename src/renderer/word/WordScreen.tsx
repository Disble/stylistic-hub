import {
  Badge,
  Button,
  Divider,
  makeStyles,
  mergeClasses,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  tokens
} from '@fluentui/react-components'
import { Checkmark16Filled, Delete20Regular, Wrench20Regular } from '@fluentui/react-icons'
import { useState, type ReactNode } from 'react'
import type { Library, WordStatus } from '../../shared/bridge'
import {
  errorMessage,
  useLibrary,
  useServerStatus,
  useWordStatus,
  WORD_MODULE_ID,
  wordModule,
  wordReady
} from '../hub-state'
import { Details, Page, Surface } from '../ui/layout'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  layout: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 300px',
    gap: '24px',
    alignItems: 'start',
    '@media (max-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr)' }
  },
  steps: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: '16px' },
  marker: {
    flex: '0 0 28px',
    height: '28px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: tokens.fontWeightSemibold,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    color: tokens.colorNeutralForeground3
  },
  markerDone: {
    border: 'none',
    backgroundColor: tokens.colorPaletteGreenBackground3,
    color: tokens.colorNeutralForegroundOnBrand
  },
  markerCurrent: {
    border: 'none',
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand
  },
  stepText: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
  stepTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  muted: { margin: 0, color: tokens.colorNeutralForeground2 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  asideTitle: { margin: 0, fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightSemibold },
  asideActions: { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px' }
})

/** One setup step: what it does, and whether it is done. */
interface WordStep {
  title: string
  done: boolean
  body: ReactNode
}

/** The three steps between this hub and Stylistic in the user's documents. */
function wordSteps(status: WordStatus, address: string, mono: string): WordStep[] {
  return [
    {
      title: 'Trust this computer’s certificate',
      done: status.caTrusted,
      body: 'Word only loads add-ins over HTTPS. Windows asks you once to trust the Stylistic certificate, which only vouches for this computer.'
    },
    {
      title: 'Add Stylistic to Word',
      done: status.addinRegistered,
      body: (
        <>
          Lists the add-in in Word for your Windows user, served from <span className={mono}>{address}</span>.
          No admin rights needed.
        </>
      )
    },
    {
      title: 'Open a document in Word',
      done: wordReady(status),
      body: 'Stylistic is on the Home tab of every document, including the ones you already have. Each time Word starts, the hub loads it; Word may show a second window for about a second while it does. Keep the hub running in the tray: it starts with Windows.'
    }
  ]
}

/** Why the Word screen cannot add anything yet: download, offer, or catalog state. */
function downloadNotice(downloaded: boolean, offer: string | null, catalogKnown: boolean): string {
  if (downloaded)
    return 'Stylistic for Word is downloaded, but the hub is not ready to add it to Word yet. The server may still be starting; the Server screen says more.'
  if (offer)
    return 'Stylistic for Word is not downloaded yet. The hub downloads it from the signed catalog when you install it; nothing is installed automatically.'
  if (catalogKnown) return 'Stylistic for Word is not offered by the catalog, so there is nothing to install.'
  return 'No catalog check has succeeded yet, so the hub does not know what it can download.'
}

/** The install / pending / check controls for a hub with nothing downloaded yet. */
function DownloadActions({
  requested,
  offer,
  download,
  onInstall,
  onCheck
}: {
  requested: boolean
  offer: string | null
  download: 'install' | 'check' | undefined
  onInstall: () => void
  onCheck: () => void
}) {
  if (requested)
    return (
      <>
        <MessageBar intent="info" role="status">
          <MessageBarBody>
            <MessageBarTitle>Install requested</MessageBarTitle>
            The hub downloads Stylistic for Word at the next catalog check.
          </MessageBarBody>
        </MessageBar>
        <span>
          <Button disabled={download !== undefined} onClick={onCheck}>
            {download === 'check' ? 'Checking…' : 'Check now'}
          </Button>
        </span>
      </>
    )
  if (!offer) return null
  return (
    <span>
      <Button appearance="primary" disabled={download !== undefined} onClick={onInstall}>
        {download === 'install' ? 'Installing…' : 'Install Stylistic for Word'}
      </Button>
    </span>
  )
}

/** What a hub with nothing in Word shows: the download notice, its actions, and any download error. */
function DownloadSection({
  downloaded,
  requested,
  offer,
  catalogKnown,
  download,
  downloadError,
  onInstall,
  onCheck
}: {
  downloaded: boolean
  requested: boolean
  offer: string | null
  catalogKnown: boolean
  download: 'install' | 'check' | undefined
  downloadError: string | undefined
  onInstall: () => void
  onCheck: () => void
}) {
  return (
    <>
      <MessageBar intent="warning">
        <MessageBarBody>{downloadNotice(downloaded, offer, catalogKnown)}</MessageBarBody>
      </MessageBar>
      {!downloaded && (
        <DownloadActions
          requested={requested}
          offer={offer}
          download={download}
          onInstall={onInstall}
          onCheck={onCheck}
        />
      )}
      {downloadError && (
        <MessageBar intent="error" role="alert">
          <MessageBarBody>
            <MessageBarTitle>Stylistic for Word was not downloaded</MessageBarTitle>
            {downloadError}
          </MessageBarBody>
        </MessageBar>
      )}
    </>
  )
}

/** One setup step with its marker and, for the current step, the Add button. */
function SetupStepItem({
  step,
  index,
  current,
  busy,
  onAction
}: {
  step: WordStep
  index: number
  current: number
  busy: 'connect' | 'disconnect' | undefined
  onAction: (kind: 'connect' | 'disconnect') => void
}) {
  const styles = useStyles()
  return (
    <li aria-label={`${step.title} · ${step.done ? 'done' : 'to do'}`}>
      <Surface className={styles.step}>
        <span
          aria-hidden
          className={mergeClasses(
            styles.marker,
            step.done && styles.markerDone,
            index === current && styles.markerCurrent
          )}
        >
          {step.done ? <Checkmark16Filled /> : index + 1}
        </span>
        <span className={styles.stepText}>
          <h2 className={styles.stepTitle}>{step.title}</h2>
          <p className={styles.muted}>{step.body}</p>
          {index === current && index < 2 && (
            <span>
              <Button
                appearance="primary"
                disabled={busy !== undefined}
                {...(busy === 'connect' && { icon: <Spinner size="tiny" /> })}
                onClick={() => onAction('connect')}
              >
                {busy === 'connect' ? 'Adding to Word…' : 'Add to Word'}
              </Button>
            </span>
          )}
        </span>
      </Surface>
    </li>
  )
}

/** The numbered setup steps once the module is downloaded. */
function SetupSteps({
  steps,
  current,
  busy,
  onAction
}: {
  steps: WordStep[]
  current: number
  busy: 'connect' | 'disconnect' | undefined
  onAction: (kind: 'connect' | 'disconnect') => void
}) {
  const styles = useStyles()
  return (
    <ol className={styles.steps} aria-label="Setup steps">
      {steps.map((step, index) => (
        <SetupStepItem
          key={step.title}
          step={step}
          index={index}
          current={current}
          busy={busy}
          onAction={onAction}
        />
      ))}
    </ol>
  )
}

/** The add-in facts with repair and remove once Stylistic is registered. */
function DetailsAside({
  status,
  address,
  busy,
  onAction
}: {
  status: WordStatus
  address: string
  busy: 'connect' | 'disconnect' | undefined
  onAction: (kind: 'connect' | 'disconnect') => void
}) {
  const styles = useStyles()
  return (
    <Surface as="aside" label="Details">
      <h2 className={styles.asideTitle}>Details</h2>
      <Details
        items={[
          { term: 'Version', value: status.version ?? '—', mono: true },
          { term: 'Works with', value: 'Word 2019 or later, Microsoft 365' },
          { term: 'Talks to', value: `${address}/api`, mono: true },
          { term: 'Documents', value: 'Spanish' }
        ]}
      />
      {status.addinRegistered && (
        <>
          <Divider />
          <div className={styles.asideActions}>
            <Button
              icon={<Wrench20Regular />}
              disabled={busy !== undefined}
              onClick={() => onAction('connect')}
            >
              Repair installation
            </Button>
            <Button
              icon={<Delete20Regular />}
              disabled={busy !== undefined}
              onClick={() => onAction('disconnect')}
            >
              Remove from Word
            </Button>
          </div>
        </>
      )}
    </Surface>
  )
}

/** Catalog download facts are separate from Word's connection/setup state. */
function downloadState(library: Library | undefined) {
  const module = wordModule(library)
  return {
    downloaded: Boolean(module?.installed),
    requested: Boolean(module?.requested),
    // Install needs a verified offer, never a guess about what the catalog will contain.
    offer: library?.catalog ? (module?.available ?? null) : null
  }
}

/** The setup progress badge is presentation, separate from connection and download actions. */
function SetupProgress({ current, total }: { current: number; total: number }) {
  if (current === -1)
    return (
      <Badge appearance="tint" color="success" size="large">
        Ready
      </Badge>
    )
  return (
    <Badge appearance="outline" color="informative" size="large">
      {`Step ${current + 1} of ${total}`}
    </Badge>
  )
}

/** Adds Stylistic to Word for this Windows user, repairs it, or removes it. */
export function WordScreen() {
  const styles = useStyles()
  const { status, refresh } = useWordStatus()
  const { library, refresh: refreshLibrary } = useLibrary()
  const address = useServerStatus()?.address ?? 'https://localhost:3000'
  const [busy, setBusy] = useState<'connect' | 'disconnect' | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [download, setDownload] = useState<'install' | 'check' | undefined>()
  const [downloadError, setDownloadError] = useState<string | undefined>()
  const { downloaded, requested, offer } = downloadState(library)

  /** Runs one action, then reads Word's status again whatever the outcome. */
  const run = (kind: 'connect' | 'disconnect') => {
    setBusy(kind)
    setError(undefined)
    window.hub.word[kind]()
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => {
        setBusy(undefined)
        refresh()
      })
  }

  const steps = status?.available ? wordSteps(status, address, styles.mono) : []
  const current = steps.findIndex((step) => !step.done)

  /** Requests the same catalog installation as the Library screen; nothing is installed automatically. */
  const install = () => {
    setDownload('install')
    setDownloadError(undefined)
    window.hub.library
      .install(WORD_MODULE_ID)
      .then(refreshLibrary, (reason: unknown) => setDownloadError(errorMessage(reason)))
      .finally(() => setDownload(undefined))
  }

  /** Runs a catalog check now, which downloads a requested module. */
  const checkNow = () => {
    setDownload('check')
    setDownloadError(undefined)
    window.hub.library
      .check()
      .then(refreshLibrary, (reason: unknown) => setDownloadError(errorMessage(reason)))
      .finally(() => setDownload(undefined))
  }

  return (
    <Page
      title="Stylistic for Word"
      description="Editorial suggestions as Track Changes in the documents you already have."
      actions={status?.available && <SetupProgress current={current} total={steps.length} />}
    >
      {status && !status.available && (
        <DownloadSection
          downloaded={downloaded}
          requested={requested}
          offer={offer}
          catalogKnown={Boolean(library?.catalog)}
          download={download}
          downloadError={downloadError}
          onInstall={install}
          onCheck={checkNow}
        />
      )}

      {busy === 'connect' && (
        <MessageBar intent="info" role="status">
          <MessageBarBody>
            <MessageBarTitle>Windows may ask you to trust the Stylistic certificate</MessageBarTitle>
            Check the taskbar for the prompt and choose Yes. It only appears the first time, or after the
            certificate is renewed.
          </MessageBarBody>
        </MessageBar>
      )}

      {error && (
        <MessageBar intent="error" role="alert">
          <MessageBarBody>
            <MessageBarTitle>Stylistic was not added to Word</MessageBarTitle>
            {error}
          </MessageBarBody>
        </MessageBar>
      )}

      {status?.available && (
        <div className={styles.layout}>
          <SetupSteps steps={steps} current={current} busy={busy} onAction={run} />
          <DetailsAside status={status} address={address} busy={busy} onAction={run} />
        </div>
      )}
    </Page>
  )
}
