import { FluentProvider, Tab, TabList, Text, Title1, webLightTheme } from '@fluentui/react-components'
import { useState } from 'react'
import { HomeScreen } from './home/HomeScreen'
import type { Screen } from './hub-state'
import { ProviderScreen } from './provider/ProviderScreen'
import { ServerScreen } from './server/ServerScreen'
import { WordScreen } from './word/WordScreen'

/** The navigation entries, in the canvas's order. */
const SCREENS: { value: Screen; label: string }[] = [
  { value: 'home', label: 'Home' },
  { value: 'word', label: 'Word' },
  { value: 'server', label: 'Server' },
  { value: 'provider', label: 'Provider' }
]

/** Root of the hub window: side navigation and the selected screen. */
export function App() {
  const { electron, node } = window.hub.versions
  const [screen, setScreen] = useState<Screen>('home')

  return (
    <FluentProvider
      theme={webLightTheme}
      style={{ minHeight: '100vh', padding: 32, display: 'grid', gap: 24, alignContent: 'start' }}
    >
      <header>
        <Title1 as="h1">Stylistic Hub</Title1>
        <Text as="p" block>
          Electron {electron} · Node {node}
        </Text>
      </header>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 32 }}>
        <TabList
          vertical
          aria-label="Main"
          selectedValue={screen}
          onTabSelect={(_event, data) => setScreen(data.value as Screen)}
        >
          {SCREENS.map(({ value, label }) => (
            <Tab key={value} value={value}>
              {label}
            </Tab>
          ))}
        </TabList>
        <main>
          {screen === 'home' && <HomeScreen onOpen={setScreen} />}
          {screen === 'word' && <WordScreen />}
          {screen === 'server' && <ServerScreen />}
          {screen === 'provider' && <ProviderScreen />}
        </main>
      </div>
    </FluentProvider>
  )
}
