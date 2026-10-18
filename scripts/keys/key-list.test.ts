import { describe, expect, it } from 'vitest'
import { keyId, rawPublicKey } from '../../src/shared/signing/keys'
import { verifyKeyList } from '../../src/shared/signing/verify'
import { createKeyList, entryFor, generateKey, signKeyList } from './key-list'

/** A fixed moment so expiry dates are predictable. */
const NOW = new Date('2026-10-17T12:00:00.000Z')

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

    const roots = [rawPublicKey(root.publicKey)]
    expect(verifyKeyList(list, signature, roots, 1, NOW)).toBe('ok')
    expect(verifyKeyList({ ...list, version: 2 }, signature, roots, 1, NOW)).toBe('bad_signature')
    expect(verifyKeyList(list, signature, [rawPublicKey(other.publicKey)], 1, NOW)).toBe('bad_signature')
  })
})
