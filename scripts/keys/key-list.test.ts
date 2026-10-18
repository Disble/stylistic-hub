import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  createKeyList,
  entryFor,
  generateKey,
  keyId,
  rawPublicKey,
  signKeyList,
  verifyKeyList
} from './key-list'

/** A fixed moment so expiry dates are predictable. */
const NOW = new Date('2026-10-17T12:00:00.000Z')

describe('canonicalJson', () => {
  it('sorts object keys at every depth so the signed bytes never depend on key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 3, e: 4 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"e":4,"f":3}]},"b":1}'
    )
  })
})

describe('keyId', () => {
  it('names a public key by the first 16 hex characters of its sha256', () => {
    const { publicKey } = generateKey()
    const id = keyId(rawPublicKey(publicKey))
    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(keyId(rawPublicKey(publicKey))).toBe(id)
  })
})

describe('createKeyList', () => {
  it('lists every online key with its role and scope, version 1, expiring 13 months later', () => {
    const catalog = generateKey()
    const component = generateKey()

    const list = createKeyList(
      [entryFor(catalog.publicKey, 'catalog'), entryFor(component.publicKey, 'component', 'stylistic-hub')],
      NOW
    )

    expect(list.version).toBe(1)
    expect(list.expires).toBe('2027-11-17T12:00:00.000Z')
    expect(list.keys).toEqual([
      {
        id: keyId(rawPublicKey(catalog.publicKey)),
        role: 'catalog',
        publicKey: rawPublicKey(catalog.publicKey).toString('base64')
      },
      {
        id: keyId(rawPublicKey(component.publicKey)),
        role: 'component',
        scope: 'stylistic-hub',
        publicKey: rawPublicKey(component.publicKey).toString('base64')
      }
    ])
  })
})

describe('signKeyList / verifyKeyList', () => {
  it('accepts the list the root key signed and rejects any change to it or another signer', () => {
    const root = generateKey()
    const other = generateKey()
    const list = createKeyList([entryFor(generateKey().publicKey, 'catalog')], NOW)

    const signature = signKeyList(list, root.privateKey)

    expect(verifyKeyList(list, signature, rawPublicKey(root.publicKey))).toBe(true)
    expect(verifyKeyList({ ...list, version: 2 }, signature, rawPublicKey(root.publicKey))).toBe(false)
    expect(verifyKeyList(list, signature, rawPublicKey(other.publicKey))).toBe(false)
  })
})
