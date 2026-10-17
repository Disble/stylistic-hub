import { makeStyles, mergeClasses, Text, tokens } from '@fluentui/react-components'
import type { ReactNode } from 'react'

/** Griffel classes from the Stylistic theme tokens. */
const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '32px', minWidth: 0 },
  header: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '16px'
  },
  heading: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
  title: {
    margin: 0,
    fontSize: tokens.fontSizeHero800,
    lineHeight: tokens.lineHeightHero800,
    fontWeight: tokens.fontWeightSemibold
  },
  description: { margin: 0, color: tokens.colorNeutralForeground2, maxWidth: '64ch' },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' },
  section: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 },
  sectionHeading: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: '8px'
  },
  sectionTitle: {
    margin: 0,
    fontSize: tokens.fontSizeBase400,
    lineHeight: tokens.lineHeightBase400,
    fontWeight: tokens.fontWeightSemibold
  },
  caption: { color: tokens.colorNeutralForeground3 },
  details: {
    margin: 0,
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '6px 16px',
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200
  },
  term: { color: tokens.colorNeutralForeground3 },
  value: { margin: 0, minWidth: 0, overflowWrap: 'anywhere' },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  surface: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    padding: '20px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
    minWidth: 0
  }
})

/** A screen: its `h1`, what it is for, and the actions that apply to all of it. */
export function Page({
  title,
  description,
  meta,
  actions,
  children
}: {
  title: string
  description?: ReactNode
  /** A short status line under the description, such as a version. */
  meta?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const styles = useStyles()
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
          {meta && (
            <Text size={200} className={styles.caption}>
              {meta}
            </Text>
          )}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </div>
  )
}

/** A titled group of a screen, with an optional caption under its `h2`. */
export function Section({
  title,
  caption,
  actions,
  label,
  children
}: {
  title: string
  caption?: ReactNode
  actions?: ReactNode
  /** Names the section for assistive technology when its title alone is ambiguous. */
  label?: string
  children: ReactNode
}) {
  const styles = useStyles()
  return (
    <section className={styles.section} aria-label={label ?? title}>
      <div className={styles.sectionHeading}>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {caption && (
            <Text size={200} className={styles.caption}>
              {caption}
            </Text>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** A white surface on the screen, as the canvas draws its cards. */
export function Surface({
  as: Tag = 'div',
  label,
  className,
  children
}: {
  as?: 'div' | 'article' | 'aside'
  label?: string
  className?: string
  children: ReactNode
}) {
  const styles = useStyles()
  return (
    <Tag aria-label={label} className={mergeClasses(styles.surface, className)}>
      {children}
    </Tag>
  )
}

/** One term and its value; `mono` sets addresses and versions in the monospace face. */
export interface Detail {
  term: string
  value: ReactNode
  mono?: boolean
}

/** A list of facts, term on the left and value on the right. */
export function Details({ items }: { items: Detail[] }) {
  const styles = useStyles()
  return (
    <dl className={styles.details}>
      {items.map(({ term, value, mono }) => (
        <div key={term} style={{ display: 'contents' }}>
          <dt className={styles.term}>{term}</dt>
          <dd className={mergeClasses(styles.value, mono && styles.mono)}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
