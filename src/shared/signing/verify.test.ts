import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  catalogSchema,
  componentSchema,
  envelopeSchema,
  keyListSchema,
  type Catalog,
  type Component,
  type KeyList,
  type KeyRole
} from './documents'
import { canonicalJson, keyId, rawPublicKey } from './keys'
import { verifyArtifact, verifyCatalog, verifyComponent, verifyKeyList } from './verify'

/** A fixed moment so expiry checks are predictable. */
const NOW = new Date('2026-10-18T12:00:00.000Z')

/** A throwaway ed25519 key pair with its key list id. */
function newKey(): { publicKey: KeyObject; privateKey: KeyObject; id: string } {
  const pair = generateKeyPairSync('ed25519')
  return { ...pair, id: keyId(rawPublicKey(pair.publicKey)) }
}

/** The base64 signature of a document's canonical JSON. */
function signature(document: unknown, privateKey: KeyObject): string {
  return sign(null, Buffer.from(canonicalJson(document)), privateKey).toString('base64')
}

/** The key list entry of a key. */
function entry(key: { publicKey: KeyObject; id: string }, role: KeyRole, scope?: string) {
  return {
    id: key.id,
    role,
    ...(scope ? { scope } : {}),
    publicKey: rawPublicKey(key.publicKey).toString('base64')
  }
}

/** The root, catalog and component keys of one test world, and the key list naming the last two. */
function world() {
  const root = newKey()
  const nextRoot = newKey()
  const catalogKey = newKey()
  const componentKey = newKey()
  const list: KeyList = keyListSchema.parse({
    version: 3,
    expires: '2027-11-18T12:00:00.000Z',
    keys: [entry(catalogKey, 'catalog'), entry(componentKey, 'component', 'stylistic-hub')]
  })
  const roots = [rawPublicKey(root.publicKey), rawPublicKey(nextRoot.publicKey)]
  return { root, nextRoot, catalogKey, componentKey, list, roots }
}

/** A valid catalog with one server entry. */
const CATALOG: Catalog = catalogSchema.parse({
  serial: 1_800_000_000,
  expires: '2026-11-01T00:00:00.000Z',
  components: [
    {
      id: 'server',
      kind: 'server',
      publisher: 'stylistic-hub',
      channel: 'stable',
      version: '0.2.0',
      sha256: 'a'.repeat(64),
      size: 10,
      artifactUrl: 'https://example.com/server-0.2.0.zip',
      componentUrl: 'https://example.com/component.json',
      rolloutPercent: 100,
      blocked: ['0.1.0-beta.2']
    }
  ]
})

/** The bytes of a sample artifact and the component.json describing them. */
const ARTIFACT = Buffer.from('zip bytes')
/** A valid server component.json for {@link ARTIFACT}. */
const COMPONENT: Component = componentSchema.parse({
  id: 'server',
  kind: 'server',
  version: '0.2.0-beta.1',
  channel: 'beta',
  sha256: createHash('sha256').update(ARTIFACT).digest('hex'),
  size: ARTIFACT.length,
  maxUncompressedSize: 100,
  requires: {},
  provides: { api: ['v1'], schemaVersion: 5, minReaderSchema: 5 },
  releaseNotes: 'https://example.com/notes'
})

describe('verifyKeyList', () => {
  it('accepts a list the root or the next root signed, at or above the last seen version, unexpired', () => {
    const { root, nextRoot, list, roots } = world()

    expect(verifyKeyList(list, signature(list, root.privateKey), roots, 3, NOW)).toBe('ok')
    expect(verifyKeyList(list, signature(list, nextRoot.privateKey), roots, 2, NOW)).toBe('ok')
  })

  it('rejects a list signed by another key as bad_signature', () => {
    const { list, roots } = world()

    expect(verifyKeyList(list, signature(list, newKey().privateKey), roots, 0, NOW)).toBe('bad_signature')
  })

  it('rejects a replayed older list (lower version) as replayed', () => {
    const { root, list, roots } = world()

    expect(verifyKeyList(list, signature(list, root.privateKey), roots, 4, NOW)).toBe('replayed')
  })

  it('rejects an expired list as expired', () => {
    const { root, list, roots } = world()
    const later = new Date('2027-11-18T12:00:00.000Z')

    expect(verifyKeyList(list, signature(list, root.privateKey), roots, 0, later)).toBe('expired')
  })

  it('rejects a root-signed list with duplicate key ids as invalid_list', () => {
    const { root, list, roots } = world()
    const duplicated = { ...list, keys: [...list.keys, ...list.keys.slice(0, 1)] }

    expect(verifyKeyList(duplicated, signature(duplicated, root.privateKey), roots, 0, NOW)).toBe(
      'invalid_list'
    )
  })

  it('rejects a root-signed list whose key id does not match its public key as invalid_list', () => {
    const { root, list, roots } = world()
    const [first, second] = list.keys
    const mismatched = { ...list, keys: [{ ...first!, id: second!.id }] }

    expect(verifyKeyList(mismatched, signature(mismatched, root.privateKey), roots, 0, NOW)).toBe(
      'invalid_list'
    )
  })

  it('rejects a root-signed list with a public key that is not 32 bytes as invalid_list', () => {
    const { root, list, roots } = world()
    const short = Buffer.alloc(31, 7)
    const truncated = {
      ...list,
      keys: [{ id: keyId(short), role: 'catalog' as const, publicKey: short.toString('base64') }]
    }

    expect(verifyKeyList(truncated, signature(truncated, root.privateKey), roots, 0, NOW)).toBe(
      'invalid_list'
    )
  })

  it('still verifies the committed keys/keys.json with the committed root public key', () => {
    const list = keyListSchema.parse(JSON.parse(readFileSync('keys/keys.json', 'utf8')))
    const root = JSON.parse(readFileSync('keys/root.pub', 'utf8')) as { id: string; publicKey: string }
    const sig = readFileSync('keys/keys.json.sig', 'utf8').trim()

    expect(root.id).toBe('a49bd78323e2340c')
    expect(verifyKeyList(list, sig, [Buffer.from(root.publicKey, 'base64')], 1, NOW)).toBe('ok')
  })
})

describe('verifyCatalog', () => {
  it('accepts a catalog signed by a listed catalog key, at or above the last seen serial, unexpired', () => {
    const { catalogKey, list } = world()
    const envelope = { keyId: catalogKey.id, signature: signature(CATALOG, catalogKey.privateKey) }

    expect(verifyCatalog(CATALOG, envelope, list, CATALOG.serial, NOW)).toBe('ok')
  })

  it('rejects a signature by a key absent from the key list as unknown_key', () => {
    const { list } = world()
    const stranger = newKey()
    const envelope = { keyId: stranger.id, signature: signature(CATALOG, stranger.privateKey) }

    expect(verifyCatalog(CATALOG, envelope, list, 0, NOW)).toBe('unknown_key')
  })

  it('rejects a signature by a listed key without the catalog role as wrong_role', () => {
    const { componentKey, list } = world()
    const envelope = { keyId: componentKey.id, signature: signature(CATALOG, componentKey.privateKey) }

    expect(verifyCatalog(CATALOG, envelope, list, 0, NOW)).toBe('wrong_role')
  })

  it('rejects a changed catalog as bad_signature', () => {
    const { catalogKey, list } = world()
    const envelope = { keyId: catalogKey.id, signature: signature(CATALOG, catalogKey.privateKey) }

    expect(verifyCatalog({ ...CATALOG, components: [] }, envelope, list, 0, NOW)).toBe('bad_signature')
  })

  it('rejects a catalog with a lower serial than the last seen one as rollback', () => {
    const { catalogKey, list } = world()
    const envelope = { keyId: catalogKey.id, signature: signature(CATALOG, catalogKey.privateKey) }

    expect(verifyCatalog(CATALOG, envelope, list, CATALOG.serial + 1, NOW)).toBe('rollback')
  })

  it('rejects an expired catalog as expired', () => {
    const { catalogKey, list } = world()
    const envelope = { keyId: catalogKey.id, signature: signature(CATALOG, catalogKey.privateKey) }

    expect(verifyCatalog(CATALOG, envelope, list, 0, new Date(CATALOG.expires))).toBe('expired')
  })
})

describe('verifyComponent', () => {
  it('accepts a component.json signed by a component key scoped to its publisher', () => {
    const { componentKey, list } = world()
    const envelope = { keyId: componentKey.id, signature: signature(COMPONENT, componentKey.privateKey) }

    expect(verifyComponent(COMPONENT, envelope, list, 'stylistic-hub')).toBe('ok')
  })

  it('rejects a signature by a key absent from the key list as unknown_key', () => {
    const { list } = world()
    const stranger = newKey()
    const envelope = { keyId: stranger.id, signature: signature(COMPONENT, stranger.privateKey) }

    expect(verifyComponent(COMPONENT, envelope, list, 'stylistic-hub')).toBe('unknown_key')
  })

  it('rejects a signature by a listed key without the component role as wrong_role', () => {
    const { catalogKey, list } = world()
    const envelope = { keyId: catalogKey.id, signature: signature(COMPONENT, catalogKey.privateKey) }

    expect(verifyComponent(COMPONENT, envelope, list, 'stylistic-hub')).toBe('wrong_role')
  })

  it('rejects a component key scoped to another publisher as wrong_scope', () => {
    const { componentKey, list } = world()
    const envelope = { keyId: componentKey.id, signature: signature(COMPONENT, componentKey.privateKey) }

    expect(verifyComponent(COMPONENT, envelope, list, 'stylistic-addon')).toBe('wrong_scope')
  })

  it('rejects a tampered component.json as bad_signature', () => {
    const { componentKey, list } = world()
    const envelope = { keyId: componentKey.id, signature: signature(COMPONENT, componentKey.privateKey) }

    expect(verifyComponent({ ...COMPONENT, sha256: 'b'.repeat(64) }, envelope, list, 'stylistic-hub')).toBe(
      'bad_signature'
    )
  })
})

describe('verifyArtifact', () => {
  /** The sha256 of some bytes, hex. */
  const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

  it('accepts the artifact component.json describes', () => {
    expect(verifyArtifact(COMPONENT, { sha256: sha256(ARTIFACT), size: ARTIFACT.length })).toBe('ok')
  })

  it('rejects an artifact of another size as size_mismatch', () => {
    expect(verifyArtifact(COMPONENT, { sha256: sha256(ARTIFACT), size: ARTIFACT.length + 1 })).toBe(
      'size_mismatch'
    )
  })

  it('rejects a tampered zip of the same size as sha256_mismatch', () => {
    const tampered = Buffer.from('zip bytez')

    expect(verifyArtifact(COMPONENT, { sha256: sha256(tampered), size: tampered.length })).toBe(
      'sha256_mismatch'
    )
  })
})

describe('documents', () => {
  it('rejects ids and versions outside their patterns', () => {
    expect(componentSchema.safeParse({ ...COMPONENT, id: 'Server' }).success).toBe(false)
    expect(componentSchema.safeParse({ ...COMPONENT, version: '1.0.0-rc.1' }).success).toBe(false)
    expect(envelopeSchema.safeParse({ keyId: 'xyz', signature: 'AA==' }).success).toBe(false)
  })
})

describe('forward compatibility', () => {
  /** Raw documents carrying an optional field a later version adds, at the top level and nested. */
  const futureCatalog = {
    ...CATALOG,
    mirrors: ['https://mirror.example.com'],
    components: CATALOG.components.map((component) => ({ ...component, minHub: '0.3.0' }))
  }
  const futureComponent = { ...COMPONENT, signedAt: '2026-10-18T12:00:00.000Z' }

  it('verifies a catalog with added fields when signed over its full content', () => {
    const { catalogKey, list } = world()
    const catalog = catalogSchema.parse(futureCatalog)
    const envelope = { keyId: catalogKey.id, signature: signature(futureCatalog, catalogKey.privateKey) }

    expect(verifyCatalog(catalog, envelope, list, 0, NOW)).toBe('ok')
    expect(verifyCatalog({ ...catalog, mirrors: [] }, envelope, list, 0, NOW)).toBe('bad_signature')
  })

  it('verifies a component.json with an added field when signed over its full content', () => {
    const { componentKey, list } = world()
    const component = componentSchema.parse(futureComponent)
    const envelope = {
      keyId: componentKey.id,
      signature: signature(futureComponent, componentKey.privateKey)
    }

    expect(verifyComponent(component, envelope, list, 'stylistic-hub')).toBe('ok')
    expect(verifyComponent({ ...component, signedAt: 'x' }, envelope, list, 'stylistic-hub')).toBe(
      'bad_signature'
    )
  })

  it('verifies a key list with added fields when signed over its full content', () => {
    const { root, list, roots } = world()
    const future = { ...list, issuer: 'disble', keys: list.keys.map((key) => ({ ...key, notAfter: '2028' })) }
    const parsed = keyListSchema.parse(future)
    const sig = signature(future, root.privateKey)

    expect(verifyKeyList(parsed, sig, roots, 0, NOW)).toBe('ok')
    expect(verifyKeyList({ ...parsed, issuer: 'mallory' }, sig, roots, 0, NOW)).toBe('bad_signature')
  })
})
