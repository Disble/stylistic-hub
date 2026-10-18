// Signs the catalog (docs/signed-releases.md): catalog.json = catalog/catalog.source.json plus `serial` (Unix
// seconds at signing) and `expires` (+14 days), and catalog.json.sig, signed with the PKCS#8 PEM in
// STYLISTIC_CATALOG_KEY. Run daily and on every catalog change by .github/workflows/catalog.yml.
// Usage: bun scripts/catalog/sign-catalog.ts [--source <file>] [--out <dir>]
import type { KeyObject } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { catalogSchema, type Catalog, type Envelope } from '../../src/shared/signing/documents'
import { keyFromEnv, signEnvelope } from '../keys/key-list'

/** `catalog/catalog.source.json`: the catalog without what signing stamps. */
export type CatalogSource = Omit<Catalog, 'serial' | 'expires'>

/** The schema of the catalog source. */
const catalogSourceSchema = catalogSchema.omit({ serial: true, expires: true })

/** How long a signed catalog stays valid; the daily job re-signs it long before. */
const VALID_DAYS = 14

/** The catalog for `source` as signed at `now`, and its signature envelope. */
export function signCatalog(
  source: CatalogSource,
  privateKey: KeyObject,
  now: Date
): { catalog: Catalog; envelope: Envelope } {
  const catalog = catalogSchema.parse({
    ...source,
    serial: Math.floor(now.getTime() / 1000),
    expires: new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000).toISOString()
  })
  return { catalog, envelope: signEnvelope(catalog, privateKey) }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string', default: 'catalog/catalog.source.json' },
      out: { type: 'string', default: 'out/catalog' }
    }
  })
  const source = catalogSourceSchema.parse(JSON.parse(readFileSync(values.source, 'utf8')))
  const { catalog, envelope } = signCatalog(source, keyFromEnv('STYLISTIC_CATALOG_KEY'), new Date())
  mkdirSync(values.out, { recursive: true })
  writeFileSync(join(values.out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)
  writeFileSync(join(values.out, 'catalog.json.sig'), `${JSON.stringify(envelope, null, 2)}\n`)
  console.log(
    `catalog.json serial ${catalog.serial}, expires ${catalog.expires}, signed by ${envelope.keyId}`
  )
}
