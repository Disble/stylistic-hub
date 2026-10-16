import { Button, MessageBar, MessageBarBody, Text, Title2 } from '@fluentui/react-components'
import { useState } from 'react'
import { errorMessage, useWordStatus, wordReady } from '../hub-state'
import { StepList } from '../StepList'

/** Adds Stylistic to Word for this Windows user, or removes it. */
export function WordScreen() {
  const { status, refresh } = useWordStatus()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  /** Runs one action, then reads Word's status again whatever the outcome. */
  const run = (action: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    action()
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => {
        setBusy(false)
        refresh()
      })
  }

  return (
    <section style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
      <div>
        <Title2 as="h2">Stylistic for Word</Title2>
        {status?.version && <Text as="p" block>{`Version ${status.version}`}</Text>}
      </div>
      {status && !status.available && (
        <MessageBar intent="warning">
          <MessageBarBody>
            The Word add-in is not bundled with this hub, or the server has not started yet.
          </MessageBarBody>
        </MessageBar>
      )}
      {status?.available && (
        <>
          <StepList
            steps={[
              {
                label: 'Trust this computer’s certificate',
                done: status.caTrusted,
                detail: 'Word only loads add-ins over HTTPS; Windows asks you once to trust the hub.'
              },
              {
                label: 'Add Stylistic to Word',
                done: status.addinRegistered,
                detail: 'Lists the add-in in Word for your Windows user. No admin rights needed.'
              },
              {
                label: 'Open Word',
                done: false,
                detail:
                  'Opens a document with the Stylistic pane. Later, Home tab → Show Task Pane. No sign-in needed.'
              }
            ]}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            {!wordReady(status) && (
              <Button appearance="primary" disabled={busy} onClick={() => run(window.hub.word.connect)}>
                Add to Word
              </Button>
            )}
            {wordReady(status) && (
              <Button appearance="primary" disabled={busy} onClick={() => run(window.hub.word.open)}>
                Open Word
              </Button>
            )}
            {status.addinRegistered && (
              <Button disabled={busy} onClick={() => run(window.hub.word.disconnect)}>
                Remove from Word
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  )
}
