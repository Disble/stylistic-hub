import { Badge, Button, Card, Subtitle2, Text, Title2 } from '@fluentui/react-components'
import { useEffect, useState } from 'react'
import { useServerStatus, useWordStatus, wordReady, type Screen } from '../hub-state'
import { SERVER_STATE } from '../server/ServerScreen'
import { StepList } from '../StepList'

/** Where the user stands with the three setup steps, and the components on this computer. */
export function HomeScreen({ onOpen }: { onOpen: (screen: Screen) => void }) {
  const server = useServerStatus()
  const { status: word } = useWordStatus()
  const [providerConnected, setProviderConnected] = useState(false)

  useEffect(() => {
    let live = true
    void window.hub.provider
      .list()
      .then((providers) => live && setProviderConnected(providers.some((p) => p.configured)))
    return () => {
      live = false
    }
  }, [])

  const steps = [
    { label: 'Local server running', done: server?.state === 'running' },
    { label: 'AI provider connected', done: providerConnected },
    { label: 'Stylistic added to Word', done: wordReady(word) }
  ]

  return (
    <section style={{ display: 'grid', gap: 24, alignContent: 'start' }}>
      <div>
        <Title2 as="h2">Welcome to Stylistic</Title2>
        <Text as="p" block>
          Editorial suggestions inside Word, written as native Track Changes. Set up both pieces once, then
          work from Word.
        </Text>
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <Subtitle2 as="h3">Next steps</Subtitle2>
        <Text size={200}>{`${steps.filter((s) => s.done).length} of ${steps.length} done`}</Text>
        <StepList steps={steps} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        <Card role="article" aria-label="Word add-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Subtitle2 as="h3">Word add-in</Subtitle2>
            <Badge appearance="tint" color={wordReady(word) ? 'success' : 'warning'}>
              {wordReady(word) ? 'Added' : 'Not added'}
            </Badge>
          </div>
          {word?.version && <Text size={200}>{`Version ${word.version}`}</Text>}
          <Button appearance={wordReady(word) ? 'secondary' : 'primary'} onClick={() => onOpen('word')}>
            {wordReady(word) ? 'Manage Word' : 'Add to Word'}
          </Button>
        </Card>
        <Card role="article" aria-label="Local server">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Subtitle2 as="h3">Local server</Subtitle2>
            {server && (
              <Badge appearance="tint" color={SERVER_STATE[server.state].color}>
                {SERVER_STATE[server.state].label}
              </Badge>
            )}
          </div>
          {server && <Text size={200}>{`Version ${server.version} · ${server.address}`}</Text>}
          <Button onClick={() => onOpen('server')}>Manage server</Button>
        </Card>
      </div>
    </section>
  )
}
