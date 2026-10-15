import { FluentProvider, Text, Title1, webLightTheme } from '@fluentui/react-components'

/** Root of the hub window. */
export function App() {
  const { electron, node } = window.hub.versions

  return (
    <FluentProvider theme={webLightTheme} style={{ minHeight: '100vh', padding: 32 }}>
      <Title1 as="h1">Stylistic Hub</Title1>
      <Text as="p" block>
        Electron {electron} · Node {node}
      </Text>
    </FluentProvider>
  )
}
