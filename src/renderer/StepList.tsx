import { Text, tokens } from '@fluentui/react-components'
import type { ReactNode } from 'react'

/** One step of a setup checklist. */
export interface Step {
  label: string
  done: boolean
  detail?: ReactNode
}

/** A checklist whose items say, also to screen readers, whether each step is done. */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
      {steps.map(({ label, done, detail }) => (
        <li
          key={label}
          aria-label={`${label} · ${done ? 'done' : 'to do'}`}
          style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}
        >
          <span
            aria-hidden="true"
            style={{
              color: done ? tokens.colorPaletteGreenForeground1 : tokens.colorNeutralForeground3,
              fontWeight: 700
            }}
          >
            {done ? '✓' : '○'}
          </span>
          <span style={{ display: 'grid', gap: 2 }}>
            <Text weight="semibold">{label}</Text>
            {detail && <Text size={200}>{detail}</Text>}
          </span>
        </li>
      ))}
    </ol>
  )
}
