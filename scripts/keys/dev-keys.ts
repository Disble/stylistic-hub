// Development signing keys (ADR 0001 D12, docs/signed-releases.md): writes a dev root, catalog and component
// key, a signed keys.json and an empty signed catalog to .dev-keys/ (gitignored), replacing what is there.
// Private keys are written unencrypted: they sign nothing a production hub trusts.
// Usage: bun run keys:dev
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KeyObject } from 'node:crypto'
import { keyId, rawPublicKey } from '../../src/shared/signing/keys'
import { signCatalog } from '../catalog/sign-catalog'
import { createKeyList, entryFor, generateKey, signKeyList } from './key-list'

/** Where the development keys and documents go. */
const DIR = '.dev-keys'

/** A JSON document as written to disk. */
function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** An unencrypted PKCS#8 PEM. */
function pem(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }).toString()
}

/** The dev root key pair: signs the dev keys.json. */
const root = generateKey()
/** The dev catalog key pair. */
const catalogKey = generateKey()
/** The dev component key pair, scoped to this repository. */
const componentKey = generateKey()
/** The dev key list naming the catalog and component keys. */
const list = createKeyList([
  entryFor(catalogKey.publicKey, 'catalog'),
  entryFor(componentKey.publicKey, 'component', 'stylistic-hub')
])
/** An empty catalog signed by the dev catalog key. */
const { catalog, envelope } = signCatalog({ components: [] }, catalogKey.privateKey, new Date())
/** The dev root's raw public key. */
const rootRaw = rawPublicKey(root.publicKey)

mkdirSync(DIR, { recursive: true })
writeFileSync(join(DIR, 'root.key.pem'), pem(root.privateKey))
writeFileSync(join(DIR, 'root.pub'), json({ id: keyId(rootRaw), publicKey: rootRaw.toString('base64') }))
writeFileSync(join(DIR, 'catalog.key.pem'), pem(catalogKey.privateKey))
writeFileSync(join(DIR, 'component.key.pem'), pem(componentKey.privateKey))
writeFileSync(join(DIR, 'keys.json'), json(list))
writeFileSync(join(DIR, 'keys.json.sig'), `${signKeyList(list, root.privateKey)}\n`)
writeFileSync(join(DIR, 'catalog.json'), json(catalog))
writeFileSync(join(DIR, 'catalog.json.sig'), json(envelope))
console.log(`Dev keys in ${DIR}: root ${keyId(rootRaw)}, catalog serial ${catalog.serial}`)
