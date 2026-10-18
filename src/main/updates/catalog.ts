// The catalog check (odd/tasks/update-engine.md S2): fetch and verify keys.json and catalog.json, then
// remember their version and serial. Any failure leaves the installed components untouched.
import {
  catalogSchema,
  envelopeSchema,
  keyListSchema,
  type Catalog,
  type KeyList
} from '../../shared/signing/documents'
import { verifyCatalog, verifyKeyList } from '../../shared/signing/verify'
import { readState, updateState } from './state'
import { CATALOG_URL } from './trust'

/** What the engine needs from the outside world: HTTP, the components directory and the time. */
export interface EngineContext {
  /** The WHATWG fetch. */
  fetch: typeof fetch
  /** `<userData>/components`. */
  root: string
  /** The current time. */
  now: () => Date
  /** The server's database, for the schema guard on server installs (odd/tasks/channels.md S2); none: no guard. */
  database?: string
}

/** A verified catalog and the key list that vouches for its keys, or why there is none. */
export type CatalogCheck =
  { status: 'ok'; catalog: Catalog; keys: KeyList } | { status: 'rejected'; reason: string }

/** A response's body as text; a non-2xx status throws, like a network error. */
export async function fetchText(fetcher: typeof fetch, url: string): Promise<string> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

/** The four catalog files, or undefined when one of them cannot be fetched. */
async function fetchCatalogFiles(fetcher: typeof fetch): Promise<string[] | undefined> {
  try {
    return await Promise.all(
      ['keys.json', 'keys.json.sig', 'catalog.json', 'catalog.json.sig'].map((file) =>
        fetchText(fetcher, CATALOG_URL + file)
      )
    )
  } catch {
    return undefined
  }
}

/** The parsed key list, catalog and catalog envelope, or undefined when one is not a valid document. */
function parseCatalogFiles(keysText: string, catalogText: string, catalogSig: string) {
  try {
    return {
      keys: keyListSchema.parse(JSON.parse(keysText)),
      catalog: catalogSchema.parse(JSON.parse(catalogText)),
      envelope: envelopeSchema.parse(JSON.parse(catalogSig))
    }
  } catch {
    return undefined
  }
}

/** Fetches and verifies the key list and the catalog with `rootKeys`, storing their version and serial. */
export async function checkCatalog(
  context: EngineContext,
  rootKeys: readonly Buffer[]
): Promise<CatalogCheck> {
  const files = await fetchCatalogFiles(context.fetch)
  if (!files) return { status: 'rejected', reason: 'network' }
  const [keysText, keysSig, catalogText, catalogSig] = files as [string, string, string, string]
  const parsed = parseCatalogFiles(keysText, catalogText, catalogSig)
  if (!parsed) return { status: 'rejected', reason: 'invalid_document' }
  const { keys, catalog, envelope } = parsed
  const state = await readState(context.root)
  const now = context.now()
  const listCheck = verifyKeyList(keys, keysSig.trim(), rootKeys, state.keysVersion, now)
  if (listCheck !== 'ok') return { status: 'rejected', reason: listCheck }
  const catalogCheck = verifyCatalog(catalog, envelope, keys, state.serial, now)
  if (catalogCheck !== 'ok') return { status: 'rejected', reason: catalogCheck }
  await updateState(context.root, (next) => {
    next.serial = catalog.serial
    next.keysVersion = keys.version
  })
  return { status: 'ok', catalog, keys }
}
