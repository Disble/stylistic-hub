// Signed fixtures for the update engine's tests: throwaway ed25519 keys, a root-signed keys.json, a signed
// catalog, and component releases in the M3 format of scripts/release/pack-component.ts (a yazl zip, a
// pretty-printed component.json and its envelope). The shell zone may import only src/shared, so this mirrors
// the scripts' few signing lines over src/shared/signing's canonical JSON instead of importing them.
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Catalog, Component, Envelope, KeyList } from '../../shared/signing/documents'
import { canonicalJson, keyId, rawPublicKey } from '../../shared/signing/keys'
import type { EngineContext } from './catalog'
import { createUpdateEngine, type UpdateEngine } from './engine'
import type { CatalogEntry } from './install'
import type { Channel } from './state'
import { CATALOG_URL } from './trust'
import { makeZip, type ZipItem } from './zip-fixtures'

/** A throwaway key: its pair, raw public key and key id. */
export interface TestKey {
  privateKey: KeyObject
  raw: Buffer
  id: string
}

/** A new throwaway ed25519 key. */
export function newKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = rawPublicKey(publicKey)
  return { privateKey, raw, id: keyId(raw) }
}

/** The base64 signature of a document's canonical JSON. */
function signature(document: unknown, key: TestKey): string {
  return sign(null, Buffer.from(canonicalJson(document)), key.privateKey).toString('base64')
}

/** A signature envelope, as `component.json.sig` and `catalog.json.sig` hold it. */
export function envelope(document: unknown, key: TestKey): Envelope {
  return { keyId: key.id, signature: signature(document, key) }
}

/** The publisher, and key scope, of the add-in module stream (docs/keys.md). */
export const ADDON_PUBLISHER = 'stylistic-addon'

/** A key list entry. */
function keyEntry(key: TestKey, role: 'catalog' | 'component', scope?: string): KeyList['keys'][number] {
  return { id: key.id, role, ...(scope ? { scope } : {}), publicKey: key.raw.toString('base64') }
}

/** One signed release: the zip, its component.json and envelope as served, and the catalog entry. */
export interface Release {
  zip: Buffer
  component: Component
  componentText: string
  envelopeText: string
  entry: CatalogEntry
}

/** What a fixture release says about itself; `maxUncompressedSize` and `component` override packing. */
export interface ReleaseOptions {
  id?: string
  kind?: string
  version: string
  /** The release stream, in component.json and the catalog entry (default `stable`). */
  channel?: Channel
  /** The catalog entry's publisher: the key scope its component.json must be signed under (default `stylistic-hub`). */
  publisher?: string
  items?: ZipItem[]
  zip?: Buffer
  requires?: Record<string, unknown>
  provides?: Record<string, unknown>
  maxUncompressedSize?: number
  /** Fields of component.json changed after packing (before signing), to break the binding. */
  component?: Partial<Component>
}

/** A signed release in the M3 format, published under `https://example.test/<id>-<version>/`. */
export async function makeRelease(options: ReleaseOptions, key: TestKey): Promise<Release> {
  const { id = 'server', kind = 'server', version, channel = 'stable', publisher = 'stylistic-hub' } = options
  const items = options.items ?? [{ name: 'entry.js', data: `console.log('${id} ${version}')` }]
  const zip = options.zip ?? (await makeZip(items))
  const component: Component = {
    id,
    kind,
    version,
    channel,
    sha256: createHash('sha256').update(zip).digest('hex'),
    size: zip.length,
    maxUncompressedSize:
      options.maxUncompressedSize ?? items.reduce((total, item) => total + Buffer.byteLength(item.data), 0),
    requires: options.requires ?? {},
    provides: options.provides ?? { api: ['v1'], schemaVersion: 3, minReaderSchema: 3 },
    releaseNotes: 'https://example.test/notes',
    ...options.component
  }
  const base = `https://example.test/${id}-${version}/`
  const entry: CatalogEntry = {
    id,
    kind,
    publisher,
    channel,
    version,
    sha256: createHash('sha256').update(zip).digest('hex'),
    size: zip.length,
    artifactUrl: `${base}${id}-${version}.zip`,
    componentUrl: `${base}component.json`,
    rolloutPercent: 100,
    blocked: []
  }
  return {
    zip,
    component,
    componentText: `${JSON.stringify(component, null, 2)}\n`,
    envelopeText: `${JSON.stringify(envelope(component, key), null, 2)}\n`,
    entry
  }
}

/** A key list, its root signature, a catalog and its envelope: the four files of the `catalog` release. */
interface CatalogFiles {
  keys: KeyList
  keysSig: string
  catalog: Catalog
  catalogSig: Envelope
}

/** The signed catalog files: keys.json signed by `root`, catalog.json by `catalogKey`. */
function makeCatalogFiles({
  root,
  catalogKey,
  keys,
  catalog
}: {
  root: TestKey
  catalogKey: TestKey
  keys: KeyList
  catalog: Catalog
}): CatalogFiles {
  return { keys, keysSig: signature(keys, root), catalog, catalogSig: envelope(catalog, catalogKey) }
}

/** One request the fake server saw. */
export interface SeenRequest {
  url: string
  range: string | null
}

/** How the fake server answers one URL: bytes, an HTTP status, a thrown error, or a body that breaks. */
export type Route =
  | Buffer
  | string
  | { status: number }
  | { error: true }
  | { breakAfter: number; data: Buffer }
  | { ignoreRange: Buffer }

/** A fake WHATWG fetch over `routes`, honouring `Range: bytes=N-` with a 206; records every request. */
function fakeFetch(routes: Map<string, Route>): { fetch: typeof fetch; seen: SeenRequest[] } {
  const seen: SeenRequest[] = []
  const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const range = new Headers(init?.headers).get('range')
    seen.push({ url, range })
    const route = routes.get(url)
    if (route === undefined) return new Response('not found', { status: 404 })
    if (typeof route === 'string') return new Response(route)
    if (Buffer.isBuffer(route)) {
      const from = range ? Number(/bytes=(\d+)-/.exec(range)?.[1]) : 0
      return new Response(new Uint8Array(route.subarray(from)), { status: range ? 206 : 200 })
    }
    if ('error' in route) throw new TypeError('fetch failed')
    if ('status' in route) return new Response('', { status: route.status })
    if ('ignoreRange' in route) return new Response(new Uint8Array(route.ignoreRange))
    const { breakAfter, data } = route
    // The first read delivers `breakAfter` bytes; the connection drops a moment later, once they are on disk.
    let sent = false
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          return controller.error(new Error('connection reset'))
        }
        sent = true
        controller.enqueue(new Uint8Array(data.subarray(0, breakAfter)))
      }
    })
    return new Response(body)
  }
  return { fetch: fetcher as typeof fetch, seen }
}

/** Routes serving the catalog files at the real catalog URL. */
function catalogRoutes(files: CatalogFiles): [string, Route][] {
  return [
    [`${CATALOG_URL}keys.json`, JSON.stringify(files.keys)],
    [`${CATALOG_URL}keys.json.sig`, `${files.keysSig}\n`],
    [`${CATALOG_URL}catalog.json`, JSON.stringify(files.catalog)],
    [`${CATALOG_URL}catalog.json.sig`, JSON.stringify(files.catalogSig)]
  ]
}

/** Routes serving a release's zip, component.json and component.json.sig. */
function releaseRoutes(release: Release): [string, Route][] {
  return [
    [release.entry.artifactUrl, release.zip],
    [release.entry.componentUrl, release.componentText],
    [`${release.entry.componentUrl}.sig`, release.envelopeText]
  ]
}

/** One test's world: keys, a temporary components directory, the fake server and the engine over them. */
export interface World {
  rootKey: TestKey
  catalogKey: TestKey
  componentKey: TestKey
  /** A component key scoped to `ADDON_PUBLISHER`, named in every key list. */
  addonKey: TestKey
  /** The components directory, under the OS temp folder. */
  root: string
  routes: Map<string, Route>
  seen: SeenRequest[]
  context: EngineContext
  engine: UpdateEngine
  /** A key list naming the catalog key, `componentKeys` (default: the component key) and the add-in key. */
  keyList(options?: { version?: number; expires?: string; componentKeys?: TestKey[] }): KeyList
  /** Serves a signed catalog of `releases` (and their files) with `keys`, `serial` and `expires`. */
  publish(options: { releases: Release[]; keys?: KeyList; serial?: number; expires?: string }): void
}

/** A fixed moment for the tests' clock. */
const NOW = new Date('2026-10-18T12:00:00.000Z')

/** A date `days` from `NOW`, as an ISO string. */
export function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString()
}

/** A fresh world with an empty components directory. */
export async function makeWorld(): Promise<World> {
  const rootKey = newKey()
  const catalogKey = newKey()
  const componentKey = newKey()
  const addonKey = newKey()
  const root = join(await mkdtemp(join(tmpdir(), 'stylistic-updates-')), 'components')
  const routes = new Map<string, Route>()
  const { fetch, seen } = fakeFetch(routes)
  const context: EngineContext = { fetch, root, now: () => NOW }
  const keyList: World['keyList'] = ({ version = 1, expires = daysFromNow(365), componentKeys } = {}) => ({
    version,
    expires,
    keys: [
      keyEntry(catalogKey, 'catalog'),
      ...(componentKeys ?? [componentKey]).map((key) => keyEntry(key, 'component', 'stylistic-hub')),
      keyEntry(addonKey, 'component', ADDON_PUBLISHER)
    ]
  })
  return {
    rootKey,
    catalogKey,
    componentKey,
    addonKey,
    root,
    routes,
    seen,
    context,
    engine: createUpdateEngine(context, [rootKey.raw]),
    keyList,
    publish({ releases, keys = keyList(), serial = 100, expires = daysFromNow(14) }) {
      const catalog: Catalog = { components: releases.map((release) => release.entry), serial, expires }
      const files = makeCatalogFiles({ root: rootKey, catalogKey, keys, catalog })
      for (const [url, route] of [...catalogRoutes(files), ...releases.flatMap(releaseRoutes)]) {
        routes.set(url, route)
      }
    }
  }
}
