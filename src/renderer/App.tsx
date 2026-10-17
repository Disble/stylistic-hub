import { FluentProvider, makeStyles, Tab, TabList, tokens } from '@fluentui/react-components'
import {
  bundleIcon,
  DocumentText24Filled,
  DocumentText24Regular,
  Home24Filled,
  Home24Regular,
  Server24Filled,
  Server24Regular,
  Sparkle24Filled,
  Sparkle24Regular,
  type FluentIcon
} from '@fluentui/react-icons'
import { useState } from 'react'
import logo from './assets/logo.png'
import { HomeScreen } from './home/HomeScreen'
import type { Screen } from './hub-state'
import { ProviderScreen } from './provider/ProviderScreen'
import { ServerScreen } from './server/ServerScreen'
import { stylisticTheme } from './theme'
import { WordScreen } from './word/WordScreen'

/** The navigation entries, in the canvas's order. */
const SCREENS: { value: Screen; label: string; icon: FluentIcon }[] = [
  { value: 'home', label: 'Home', icon: bundleIcon(Home24Filled, Home24Regular) },
  { value: 'word', label: 'Word', icon: bundleIcon(DocumentText24Filled, DocumentText24Regular) },
  { value: 'server', label: 'Server', icon: bundleIcon(Server24Filled, Server24Regular) },
  { value: 'provider', label: 'Provider', icon: bundleIcon(Sparkle24Filled, Sparkle24Regular) }
]

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  root: {
    display: 'flex',
    height: '100vh',
    backgroundColor: tokens.colorNeutralBackground4,
    color: tokens.colorNeutralForeground1
  },
  rail: {
    flex: '0 0 80px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    padding: '16px 0'
  },
  logo: { width: '32px', height: '32px', display: 'block' },
  tab: { width: '64px', padding: '8px 0', justifyContent: 'center' },
  // Inside the tab's content, as the canvas stacks the icon over the label; Fluent's own icon slot sits beside it.
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200
  },
  surface: {
    flex: '1 1 auto',
    minWidth: 0,
    overflowY: 'auto',
    margin: '8px 8px 8px 0',
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: '36px 44px'
  },
  content: { maxWidth: '1120px' }
})

/** Root of the hub window: the navigation rail and the selected screen on its surface. */
export function App() {
  const styles = useStyles()
  const [screen, setScreen] = useState<Screen>('home')

  return (
    <FluentProvider theme={stylisticTheme} className={styles.root}>
      <nav aria-label="Main" className={styles.rail}>
        <img src={logo} alt="Stylistic" className={styles.logo} />
        <TabList
          vertical
          appearance="subtle"
          aria-label="Screens"
          selectedValue={screen}
          onTabSelect={(_event, data) => setScreen(data.value as Screen)}
        >
          {SCREENS.map(({ value, label, icon: Icon }) => (
            <Tab key={value} value={value} className={styles.tab}>
              <span className={styles.tabContent}>
                <Icon aria-hidden fontSize={24} />
                {label}
              </span>
            </Tab>
          ))}
        </TabList>
      </nav>
      <main className={styles.surface}>
        <div className={styles.content}>
          {screen === 'home' && <HomeScreen onOpen={setScreen} />}
          {screen === 'word' && <WordScreen />}
          {screen === 'server' && <ServerScreen onOpen={setScreen} />}
          {screen === 'provider' && <ProviderScreen />}
        </div>
      </main>
    </FluentProvider>
  )
}
