// The hub's contract with an add-in build (docs/addin-contract.md): which script builds it, what its dist/ must
// hold, and what the hub does to that output before serving it. Used by scripts/bundle-addin.ts.
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { writeAddinDocument } from './addin-document'

/** Where the hub serves the add-in, so where Word must load it from. */
export const HUB_ORIGIN = 'https://localhost:3000'

/** The task pane page Word opens: `<DefaultSettings><SourceLocation DefaultValue="…"/>`. */
const TASKPANE_SOURCE = /<DefaultSettings>[\s\S]*?<SourceLocation\s+DefaultValue="([^"]+)"/

/** How a problem report says the manifest has no task pane page. */
const NO_TASKPANE_SOURCE = 'has no task pane <SourceLocation DefaultValue="…"> in <DefaultSettings>'

/** The add-in script that builds it for the hub: `build:hub` when the checkout has one, else `build`. */
export function buildScript(packageJson: string): 'build:hub' | 'build' {
  const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {}
  if (scripts['build:hub']) return 'build:hub'
  if (scripts.build) return 'build'
  throw new Error('The add-in package.json has no "build:hub" or "build" script')
}

/** The origin of the task pane page, or undefined when the manifest names none. */
function taskpaneOrigin(manifest: string): string | undefined {
  const url = TASKPANE_SOURCE.exec(manifest)?.[1]
  if (!url || !URL.canParse(url)) return undefined
  return new URL(url).origin
}

/**
 * Points every URL of the task pane's origin at `origin`, whatever origin the add-in's own build wrote (its
 * production build names a placeholder host). A host that merely starts with that origin is left alone.
 */
export function pointManifestAt(manifest: string, origin = HUB_ORIGIN): string {
  const current = taskpaneOrigin(manifest)
  if (!current) throw new Error(`The add-in manifest ${NO_TASKPANE_SOURCE}`)
  if (current === origin) return manifest
  const escaped = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return manifest.replace(new RegExp(`${escaped}(?![\\w.:-])`, 'g'), origin)
}

/** What the build in `dist` lacks for the hub to serve it; empty when it meets the contract. */
export function checkAddinBuild(dist: string): string[] {
  const problems: string[] = []
  const manifest = join(dist, 'manifest.xml')
  const taskpane = join(dist, 'taskpane.html')
  if (!existsSync(manifest)) problems.push(`${manifest} is missing`)
  else if (!taskpaneOrigin(readFileSync(manifest, 'utf8'))) problems.push(`${manifest} ${NO_TASKPANE_SOURCE}`)
  if (!existsSync(taskpane)) problems.push(`${taskpane} is missing`)
  else if (!readFileSync(taskpane, 'utf8').includes('</head>'))
    problems.push(`${taskpane} has no </head>, where the hub puts the token meta tag`)
  return problems
}

/**
 * Replaces `target` with the build in `dist`, pointed at the hub, without source maps and with Stylistic.docx.
 * The build is checked and prepared next to `target` first, so a build that fails leaves `target` as it was.
 */
export function stageAddin(dist: string, target: string): void {
  const problems = checkAddinBuild(dist)
  if (problems.length > 0) {
    throw new Error(
      `The add-in build in ${dist} does not meet the hub's contract (docs/addin-contract.md):\n` +
        problems.map((problem) => `- ${problem}`).join('\n')
    )
  }
  const staging = join(dirname(target), '.addin-staging')
  const previous = join(dirname(target), '.addin-previous')
  rmSync(staging, { recursive: true, force: true })
  rmSync(previous, { recursive: true, force: true })
  try {
    // Source maps stay behind: the hub would serve them and they only add size to the installer.
    cpSync(dist, staging, { recursive: true, filter: (source) => !source.endsWith('.map') })
    const manifest = join(staging, 'manifest.xml')
    writeFileSync(manifest, pointManifestAt(readFileSync(manifest, 'utf8')))
    writeAddinDocument(staging)
    if (existsSync(target)) renameSync(target, previous)
    renameSync(staging, target)
  } catch (error) {
    if (!existsSync(target) && existsSync(previous)) renameSync(previous, target)
    throw error
  } finally {
    rmSync(staging, { recursive: true, force: true })
    rmSync(previous, { recursive: true, force: true })
  }
}
