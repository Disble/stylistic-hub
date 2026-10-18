// The signed list of online keys (docs/keys.md): the root key signs it, the hub trusts what it lists.
// The signing side; verification lives in src/shared/signing, which the hub uses too.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { Envelope, KeyList, KeyRole } from '../../src/shared/signing/documents'
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

/** A signature over a document's canonical JSON, base64. */
function signature(document: unknown, privateKey: KeyObject): string {
  return sign(null, Buffer.from(canonicalJson(document)), privateKey).toString('base64')
}

/** The root key's detached signature over the canonical key list, base64 (`keys.json.sig`). */
export function signKeyList(list: KeyList, rootPrivateKey: KeyObject): string {
  return signature(list, rootPrivateKey)
}

/** The signature envelope (`<file>.sig`) of a catalog or component.json: the signer's key id and its signature. */
export function signEnvelope(document: unknown, privateKey: KeyObject): Envelope {
  return {
    keyId: keyId(rawPublicKey(createPublicKey(privateKey))),
    signature: signature(document, privateKey)
  }
}

/** The private key whose PKCS#8 PEM is in the environment variable `name` (a GitHub secret in CI). */
export function keyFromEnv(name: string): KeyObject {
  const pem = process.env[name]
  if (!pem) throw new Error(`${name} is not set: it holds the signing key's PKCS#8 PEM`)
  return createPrivateKey(pem)
}
