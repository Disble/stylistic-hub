import { makeStyles, tokens } from '@fluentui/react-components'
import { CheckmarkCircle20Filled, Circle20Regular } from '@fluentui/react-icons'

/** One step of a setup checklist. */
export interface Step {
  label: string
  done: boolean
}

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  list: {
    margin: 0,
    padding: 0,
    listStyle: 'none',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px 20px',
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200
  },
  item: { display: 'flex', gap: '6px', alignItems: 'center' },
  done: { color: tokens.colorPaletteGreenForeground1 },
  todo: { color: tokens.colorPaletteDarkOrangeForeground1 }
})

/** A one-line checklist whose items say, also to screen readers, whether each step is done. */
export function StepList({ steps }: { steps: Step[] }) {
  const styles = useStyles()
  return (
    <ol className={styles.list}>
      {steps.map(({ label, done }) => (
        <li key={label} aria-label={`${label} · ${done ? 'done' : 'to do'}`} className={styles.item}>
          {done ? (
            <CheckmarkCircle20Filled aria-hidden className={styles.done} />
          ) : (
            <Circle20Regular aria-hidden className={styles.todo} />
          )}
          {label}
        </li>
      ))}
    </ol>
  )
}
