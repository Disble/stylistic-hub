// The signed list of online keys (docs/keys.md): the root key signs it, the hub trusts what it lists.
// The signing side; verification lives in src/shared/signing, which the hub uses too.
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { KeyList, KeyRole } from '../../src/shared/signing/documents'
import { canonicalJson, keyId, rawPublicKey } from '../../src/shared/signing/keys'

/** One online key as the hub sees it. */
export type KeyEntry = KeyList['keys'][number]

/** How long a key list stays valid: re-signed every year, a month of margin for a late ceremony. */
const VALID_MONTHS = 13

/** A new ed25519 key pair. */
export function generateKey(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519')
}

/** The key list entry for a public key. */
export function entryFor(publicKey: KeyObject, role: KeyRole, scope?: string): KeyEntry {
  const raw = rawPublicKey(publicKey)
  return { id: keyId(raw), role, ...(scope ? { scope } : {}), publicKey: raw.toString('base64') }
}

/** The first key list: version 1, valid for 13 months from `now`. */
export function createKeyList(keys: KeyEntry[], now = new Date()): KeyList {
  const expires = new Date(now)
  expires.setUTCMonth(expires.getUTCMonth() + VALID_MONTHS)
  return { version: 1, expires: expires.toISOString(), keys }
}

/** The root key's detached signature over the canonical key list, base64. */
export function signKeyList(list: KeyList, rootPrivateKey: KeyObject): string {
  return sign(null, Buffer.from(canonicalJson(list)), rootPrivateKey).toString('base64')
}
