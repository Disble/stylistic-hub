// Writes a released component's entry into the catalog source (odd/tasks/catalog-auto-update.md S3): built from
// the release's signed component.json and its one artifact, replacing the entry of the same id and channel and
// keeping that entry's rollout and pulled versions. Run by the `catalog-entry` job of .github/workflows/ci.yml.
// Usage: bun scripts/catalog/catalog-entry.ts --source <catalog.source.json> --component <component.json>
//   --publisher <name> --release <release download URL ending in /> --asset <name> [--asset <name> ...]
// Prints `changed` (and writes the source) or `unchanged`.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { format, resolveConfig } from 'prettier'
import { catalogSchema, componentSchema, type Component } from '../../src/shared/signing/documents'
import type { CatalogSource } from './sign-catalog'

/** One entry of the catalog source. */
type Entry = CatalogSource['components'][number]

/** The files every release carries beside its artifact. */
const SIGNED_FILES = new Set(['component.json', 'component.json.sig'])

/**
 * The catalog entry of the release at `release` (its download folder URL) with `assets`: the sha256 and size its
 * signed `component` pins, its one artifact, fully rolled out and not pulled. Throws unless exactly one asset is
 * neither `component.json` nor its signature, so a release with a stray file never guesses its artifact.
 */
export function catalogEntry({
  component,
  publisher,
  release,
  assets
}: {
  component: Component
  publisher: string
  release: string
  assets: readonly string[]
}): Entry {
  const artifacts = assets.filter((asset) => !SIGNED_FILES.has(asset))
  const [artifact] = artifacts
  if (artifacts.length !== 1 || !artifact)
    throw new Error(`${release} needs exactly one artifact beside component.json, found ${artifacts.length}`)
  const { id, kind, channel, version, sha256, size } = component
  return {
    id,
    kind,
    publisher,
    channel,
    version,
    sha256,
    size,
    artifactUrl: new URL(artifact, release).href,
    componentUrl: new URL('component.json', release).href,
    rolloutPercent: 100,
    blocked: []
  }
}

/**
 * `source` with `entry` in place of the entry of the same id and channel (its `rolloutPercent` and `blocked`
 * kept), or added at the end; unchanged when that entry already names this version and sha256. Never mutates.
 */
export function upsertEntry(
  source: CatalogSource,
  entry: Entry
): { changed: boolean; source: CatalogSource } {
  const index = source.components.findIndex((item) => item.id === entry.id && item.channel === entry.channel)
  const current = source.components[index]
  if (current?.version === entry.version && current.sha256 === entry.sha256) return { changed: false, source }
  const components = [...source.components]
  if (current)
    components[index] = { ...entry, rolloutPercent: current.rolloutPercent, blocked: current.blocked }
  else components.push(entry)
  return { changed: true, source: { ...source, components } }
}

/**
 * `source` as JSON formatted by prettier with the config that applies at `filepath`, so the repository's
 * `prettier --check .` passes: plain `JSON.stringify` breaks a short `blocked` list over several lines.
 */
export async function formatSource(source: CatalogSource, filepath: string): Promise<string> {
  return format(JSON.stringify(source), { ...(await resolveConfig(filepath)), filepath })
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'catalog/catalog.source.json' },
      component: { type: 'string' },
      publisher: { type: 'string' },
      release: { type: 'string' },
      asset: { type: 'string', multiple: true, default: [] }
    }
  })
  if (!values.component || !values.publisher || !values.release)
    throw new Error('--component, --publisher and --release are required')
  const source = catalogSchema
    .omit({ serial: true, expires: true })
    .parse(JSON.parse(readFileSync(values.source, 'utf8')))
  const entry = catalogEntry({
    component: componentSchema.parse(JSON.parse(readFileSync(values.component, 'utf8'))),
    publisher: values.publisher,
    release: values.release,
    assets: values.asset
  })
  const result = upsertEntry(source, entry)
  if (result.changed) writeFileSync(values.source, await formatSource(result.source, values.source))
  console.log(result.changed ? 'changed' : 'unchanged')
}
