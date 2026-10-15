import { FluentProvider, Text, Title1, webLightTheme } from '@fluentui/react-components'
import { ProviderScreen } from './provider/ProviderScreen'

/** Root of the hub window. Navigation between screens arrives with T9. */
export function App() {
  const { electron, node } = window.hub.versions

  return (
    <FluentProvider
      theme={webLightTheme}
      style={{ minHeight: '100vh', padding: 32, display: 'grid', gap: 24 }}
    >
      <header>
        <Title1 as="h1">Stylistic Hub</Title1>
        <Text as="p" block>
          Electron {electron} · Node {node}
        </Text>
      </header>
      <ProviderScreen />
    </FluentProvider>
  )
}
