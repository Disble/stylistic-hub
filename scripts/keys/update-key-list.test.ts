import { createPrivateKey } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { keyId, rawPublicKey } from '../../src/shared/signing/keys'
import { verifyCatalog, verifyKeyList } from '../../src/shared/signing/verify'
import { signCatalog } from '../catalog/sign-catalog'
import { createKeyList, entryFor, generateKey, ONLINE_KEYS, signKeyList } from './key-list'
import { updateKeyList } from './update-key-list'

/** When the first list was signed. */
const START = new Date('2026-10-18T12:00:00.000Z')
/** When the maintainer updates it. */
const LATER = new Date('2027-01-10T12:00:00.000Z')

/** A throwaway root, a first signed key list naming a catalog and a component key, and their private keys. */
function firstList() {
  const root = generateKey()
  const catalog = generateKey()
  const component = generateKey()
  const list = createKeyList(
    [entryFor(catalog.publicKey, 'catalog'), entryFor(component.publicKey, 'component', 'stylistic-hub')],
    START
  )
  return { root, catalog, component, list, signature: signKeyList(list, root.privateKey) }
}

describe('updateKeyList', () => {
  it('rotates an online key end to end: new secret, new root-signed list, old list then replayed', () => {
    const { root, catalog, list, signature } = firstList()
    const roots = [rawPublicKey(root.publicKey)]
    const secrets: { secret: string; repo: string; pem: string }[] = []

    const rotated = updateKeyList(list, { rotate: 'catalog' }, root.privateKey, LATER, (target, pem) =>
      secrets.push({ secret: target.secret, repo: target.repo, pem })
    )

    expect(secrets).toEqual([
      { secret: 'STYLISTIC_CATALOG_KEY', repo: ONLINE_KEYS[0].repo, pem: expect.any(String) }
    ])
    const newKey = createPrivateKey(secrets[0]?.pem ?? '')
    expect(rotated.list.version).toBe(2)
    expect(rotated.list.expires).toBe('2028-02-10T12:00:00.000Z')
    expect(rotated.list.keys.map((key) => key.role).sort()).toEqual(['catalog', 'component'])
    expect(verifyKeyList(rotated.list, rotated.signature, roots, list.version, LATER)).toBe('ok')
    expect(verifyKeyList(list, signature, roots, rotated.list.version, LATER)).toBe('replayed')

    const byNewKey = signCatalog({ components: [] }, newKey, LATER)
    const byOldKey = signCatalog({ components: [] }, catalog.privateKey, LATER)
    expect(verifyCatalog(byNewKey.catalog, byNewKey.envelope, rotated.list, 0, LATER)).toBe('ok')
    expect(verifyCatalog(byOldKey.catalog, byOldKey.envelope, rotated.list, 0, LATER)).toBe('unknown_key')
  })

  it('revokes a key: a catalog it signed is then rejected as unknown_key', () => {
    const { root, catalog, list } = firstList()
    const revokedId = keyId(rawPublicKey(catalog.publicKey))
    const byRevoked = signCatalog({ components: [] }, catalog.privateKey, LATER)
    expect(verifyCatalog(byRevoked.catalog, byRevoked.envelope, list, 0, LATER)).toBe('ok')

    const revoked = updateKeyList(list, { revoke: revokedId }, root.privateKey, LATER, () => {
      throw new Error('revoking sets no secret')
    })

    expect(revoked.list.version).toBe(2)
    expect(revoked.list.keys.map((key) => key.id)).not.toContain(revokedId)
    expect(verifyKeyList(revoked.list, revoked.signature, [rawPublicKey(root.publicKey)], 1, LATER)).toBe(
      'ok'
    )
    expect(verifyCatalog(byRevoked.catalog, byRevoked.envelope, revoked.list, 0, LATER)).toBe('unknown_key')
  })

  it('refuses an unknown target or key id', () => {
    const { root, list } = firstList()

    expect(() => updateKeyList(list, { rotate: 'nobody' }, root.privateKey, LATER, () => {})).toThrow(
      'Unknown target nobody'
    )
    expect(() =>
      updateKeyList(list, { revoke: '0000000000000000' }, root.privateKey, LATER, () => {})
    ).toThrow('No key 0000000000000000')
  })
})
