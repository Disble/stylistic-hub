// Installs one catalog entry (odd/tasks/update-engine.md S2): component.json and its signature, the binding
// check, the publisher's signature, compatibility, the resumable zip download, its sha256 and size, strict
// extraction into staging, the rename into place, and only then the state switch. The hub's installer (S4) goes
// through the same checks and download into staging, and stops there: electron-updater installs it.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  componentSchema,
  envelopeSchema,
  type Catalog,
  type Component,
  type KeyList
} from '../../shared/signing/documents'
import { readSchemaState } from '../../shared/schema-state'
import { verifyArtifact, verifyComponent } from '../../shared/signing/verify'
import { fetchText, type EngineContext } from './catalog'
import { downloadResumable, fileSize } from './download'
import { extractZip } from './extract'
import type { StagedInstaller } from './feed'
import { addHistory, componentState, readState, updateState, writeAtomic } from './state'

/** One component of the catalog. */
export type CatalogEntry = Catalog['components'][number]

/** What became of an install. */
export type InstallOutcome = { status: 'installed' } | { status: 'failed'; reason: string }

/** `<id>/<version>.json`: the verified component.json of an installed version and the envelope that signed it. */
const installedSchema = z.object({ component: componentSchema, envelope: envelopeSchema })

/** An installed version's record. */
export type InstalledVersion = z.infer<typeof installedSchema>

/** The hub's component id, and the only key scope its installer is accepted from. */
export const HUB_ID = 'stylistic-hub'

/** The fields a signed component.json must share with the catalog entry that points at it. */
const BOUND_FIELDS = ['id', 'kind', 'version', 'channel', 'sha256'] as const

/** Reads the record of an installed version. */
export async function readInstalled(root: string, id: string, version: string): Promise<InstalledVersion> {
  return installedSchema.parse(JSON.parse(await readFile(join(root, id, `${version}.json`), 'utf8')))
}

/** The APIs an installed component requires that `component` would no longer provide, by component id. */
async function brokenRequirements(root: string, component: Component): Promise<string[]> {
  const provided = component.provides.api
  if (!Array.isArray(provided)) return []
  const state = await readState(root)
  const broken: string[] = []
  for (const [id, installed] of Object.entries(state.components)) {
    if (id === component.id || !installed.current) continue
    const { requires } = (await readInstalled(root, id, installed.current)).component
    const missing = [requires.api]
      .flat()
      .filter((api): api is string => typeof api === 'string' && !provided.includes(api))
    if (missing.length > 0) broken.push(`${id} requires api ${missing.join(', ')}`)
  }
  return broken
}

/** How a schema-guard refusal ends, so the Server screen can tell it from other failed installs. */
const SCHEMA_HOLD = ' reads this database'

/** Whether a failed install's reason is the schema guard's. */
export function isSchemaHold(reason: string): boolean {
  return reason.endsWith(SCHEMA_HOLD)
}

/**
 * The schema guard (odd/tasks/channels.md S2): a server whose `provides.schemaVersion` is below the database's
 * `minReaderSchema` would refuse the database, so the running server stays; why, or undefined when it may install.
 */
async function schemaHold(context: EngineContext, component: Component): Promise<string | undefined> {
  if (component.kind !== 'server' || !context.database || !existsSync(context.database)) return undefined
  const schema = component.provides['schemaVersion']
  if (typeof schema === 'number' && schema >= readSchemaState(context.database).minReaderSchema)
    return undefined
  const current = (await readState(context.root)).components[component.id]?.current ?? 'the built-in server'
  return `stays on ${current} until ${component.channel}${SCHEMA_HOLD}`
}

/** The JSON value of `text`, or undefined when it is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Fetches, verifies and stores component.json and its envelope in staging; returns them or why not. */
async function fetchComponent(
  context: EngineContext,
  entry: CatalogEntry,
  keys: KeyList,
  staging: string
): Promise<InstalledVersion | string> {
  let componentText: string, envelopeText: string
  try {
    componentText = await fetchText(context.fetch, entry.componentUrl)
    envelopeText = await fetchText(context.fetch, `${entry.componentUrl}.sig`)
  } catch {
    return 'network'
  }
  await writeFile(join(staging, 'component.json'), componentText)
  await writeFile(join(staging, 'component.json.sig'), envelopeText)
  const component = componentSchema.safeParse(parseJson(componentText))
  const envelope = envelopeSchema.safeParse(parseJson(envelopeText))
  if (!component.success || !envelope.success) return 'invalid_document'
  if (BOUND_FIELDS.some((field) => component.data[field] !== entry[field])) return 'binding_mismatch'
  const signature = verifyComponent(component.data, envelope.data, keys, entry.publisher)
  if (signature !== 'ok') return signature
  const broken = await brokenRequirements(context.root, component.data)
  if (broken.length > 0) return `incompatible: ${broken.join('; ')}`
  const hold = await schemaHold(context, component.data)
  if (hold) return hold
  return { component: component.data, envelope: envelope.data }
}

/** Downloads (or resumes) the artifact and checks its size and sha256; a mismatching file is deleted. */
async function downloadArtifact(
  context: EngineContext,
  entry: CatalogEntry,
  component: Component,
  file: string
): Promise<string> {
  if (fileSize(file) < component.size && !(await downloadResumable(context.fetch, entry.artifactUrl, file))) {
    return 'network'
  }
  const bytes = await readFile(file)
  const measured = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  const check = verifyArtifact(component, measured)
  if (check !== 'ok') await rm(file, { force: true })
  return check
}

/** Creates `staging` and discards everything in it but `keep`, the artifact a new attempt resumes. */
async function prepareStaging(staging: string, keep: string): Promise<void> {
  await mkdir(staging, { recursive: true })
  for (const name of await readdir(staging)) {
    if (name !== keep) await rm(join(staging, name), { recursive: true, force: true })
  }
}

/** Everything up to the rename into `<id>/<version>/`; returns the verified record or why the install stopped. */
async function stage(
  context: EngineContext,
  entry: CatalogEntry,
  keys: KeyList,
  dir: string
): Promise<InstalledVersion | string> {
  const staging = join(dir, '.staging')
  const zip = join(staging, `${entry.version}.zip`)
  // Leftovers of another version or of an interrupted extraction are discarded; this version's zip is resumed.
  await prepareStaging(staging, basename(zip))
  const installed = await fetchComponent(context, entry, keys, staging)
  if (typeof installed === 'string') return installed
  const download = await downloadArtifact(context, entry, installed.component, zip)
  if (download !== 'ok') return download
  const extracted = join(staging, entry.version)
  const extraction = await extractZip(zip, extracted, installed.component.maxUncompressedSize)
  if (extraction !== 'ok') return extraction
  const target = join(dir, entry.version)
  await rm(target, { recursive: true, force: true })
  await rename(extracted, target)
  await writeAtomic(join(dir, `${entry.version}.json`), `${JSON.stringify(installed, null, 2)}\n`)
  return installed
}

/**
 * Downloads and verifies the hub installer of `entry` into `<id>/.staging/<id>-<version>.exe`, signed under
 * `keys` by a key scoped to the hub: the binding check, the signature and the sha256 and size, no extraction and
 * no state change. Returns the verified installer or why not.
 */
export async function stageHubInstaller(
  context: EngineContext,
  entry: CatalogEntry,
  keys: KeyList
): Promise<StagedInstaller | string> {
  const staging = join(context.root, entry.id, '.staging')
  const file = join(staging, `${entry.id}-${entry.version}.exe`)
  await prepareStaging(staging, basename(file))
  const installed = await fetchComponent(context, { ...entry, publisher: HUB_ID }, keys, staging)
  if (typeof installed === 'string') return installed
  const download = await downloadArtifact(context, entry, installed.component, file)
  return download === 'ok' ? { file, component: installed.component } : download
}

/** Deletes every version folder and record except `keep`, and the staging directory. */
async function prune(dir: string, keep: (string | null)[]): Promise<void> {
  const kept = new Set(keep.flatMap((version) => (version ? [version, `${version}.json`] : [])))
  for (const name of await readdir(dir)) {
    if (!kept.has(name)) await rm(join(dir, name), { recursive: true, force: true })
  }
}

/** Downloads, verifies and installs `entry`, signed under `keys`; the current version stays until it succeeds. */
export async function installComponent(
  context: EngineContext,
  entry: CatalogEntry,
  keys: KeyList
): Promise<InstallOutcome> {
  const dir = join(context.root, entry.id)
  const before = componentState(await readState(context.root), entry.id)
  const result =
    before.current === entry.version ? 'already_installed' : await stage(context, entry, keys, dir)
  const time = context.now().toISOString()
  const history = { time, component: entry.id, from: before.current, to: entry.version }
  if (typeof result === 'string') {
    await updateState(context.root, (state) => {
      addHistory(state, { ...history, outcome: 'failed', reason: result })
    })
    return { status: 'failed', reason: result }
  }
  const after = await updateState(context.root, (state) => {
    const component = componentState(state, entry.id)
    if (component.current) component.previous = component.current
    component.current = entry.version
    component.keyId = result.envelope.keyId
    addHistory(state, { ...history, outcome: 'installed', reason: null })
  })
  const { current, previous } = componentState(after, entry.id)
  await prune(dir, [current, previous])
  return { status: 'installed' }
}
