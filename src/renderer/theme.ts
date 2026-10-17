import { webLightTheme, type Theme } from '@fluentui/react-components'

/**
 * Stylistic's design system: Fluent 2 light with the warm neutrals the add-in and the canvas use
 * (`.stylistic-theme`). Only the tokens that differ from `webLightTheme` are set; the brand ramp is
 * Fluent's own (#0f6cbd), so components keep their states and contrast.
 */
export const stylisticTheme: Theme = {
  ...webLightTheme,
  colorNeutralForeground1: '#201f1e',
  colorNeutralForeground2: '#4b4947',
  colorNeutralForeground3: '#7a7876',
  colorNeutralBackground2: '#fafafa',
  colorNeutralBackground3: '#f6f5f4',
  /** The window's ground behind the navigation and the screen surface. */
  colorNeutralBackground4: '#f1efed',
  colorNeutralStroke2: '#e1dfdd',
  colorNeutralStroke3: '#edebe9',
  borderRadiusMedium: '4px'
}
