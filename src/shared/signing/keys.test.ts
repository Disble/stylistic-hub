import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJson, keyId, rawPublicKey } from './keys'

describe('canonicalJson', () => {
  it('sorts object keys at every depth so the signed bytes never depend on key order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 3, e: 4 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"e":4,"f":3}]},"b":1}'
    )
  })
})

describe('keyId', () => {
  it('names a public key by the first 16 hex characters of its sha256', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const id = keyId(rawPublicKey(publicKey))

    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(keyId(rawPublicKey(publicKey))).toBe(id)
  })
})

describe('rawPublicKey', () => {
  it('refuses a key that is not ed25519', () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })

    expect(() => rawPublicKey(publicKey)).toThrow('Not an ed25519 public key')
  })
})
