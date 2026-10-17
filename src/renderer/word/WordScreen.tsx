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
import type { WordStatus } from '../../shared/bridge'
import { errorMessage, useServerStatus, useWordStatus, wordReady } from '../hub-state'
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

/** Adds Stylistic to Word for this Windows user, repairs it, or removes it. */
export function WordScreen() {
  const styles = useStyles()
  const { status, refresh } = useWordStatus()
  const address = useServerStatus()?.address ?? 'https://localhost:3000'
  const [busy, setBusy] = useState<'connect' | 'disconnect' | undefined>()
  const [error, setError] = useState<string | undefined>()

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

  return (
    <Page
      title="Stylistic for Word"
      description="Editorial suggestions as Track Changes in the documents you already have."
      actions={
        status?.available &&
        (current === -1 ? (
          <Badge appearance="tint" color="success" size="large">
            Ready
          </Badge>
        ) : (
          <Badge appearance="outline" color="informative" size="large">
            {`Step ${current + 1} of ${steps.length}`}
          </Badge>
        ))
      }
    >
      {status && !status.available && (
        <MessageBar intent="warning">
          <MessageBarBody>
            The Word add-in is not bundled with this hub, or the server has not started yet.
          </MessageBarBody>
        </MessageBar>
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
          <ol className={styles.steps} aria-label="Setup steps">
            {steps.map((step, index) => (
              <li key={step.title} aria-label={`${step.title} · ${step.done ? 'done' : 'to do'}`}>
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
                          onClick={() => run('connect')}
                        >
                          {busy === 'connect' ? 'Adding to Word…' : 'Add to Word'}
                        </Button>
                      </span>
                    )}
                  </span>
                </Surface>
              </li>
            ))}
          </ol>

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
                    onClick={() => run('connect')}
                  >
                    Repair installation
                  </Button>
                  <Button
                    icon={<Delete20Regular />}
                    disabled={busy !== undefined}
                    onClick={() => run('disconnect')}
                  >
                    Remove from Word
                  </Button>
                </div>
              </>
            )}
          </Surface>
        </div>
      )}
    </Page>
  )
}
