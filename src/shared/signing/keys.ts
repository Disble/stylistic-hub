/// <reference types="node" />
// Key ids, canonical JSON and the ed25519 check every signed document shares (docs/signed-releases.md).
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'

/** The raw 32 bytes of an ed25519 public key. */
export function rawPublicKey(key: KeyObject): Buffer {
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Not an ed25519 public key')
  // An ed25519 SubjectPublicKeyInfo is a fixed 12-byte header followed by the raw key.
  return key.export({ type: 'spki', format: 'der' }).subarray(12)
}

/** A key's id: the first 16 hex characters of the sha256 of its raw public key. */
export function keyId(publicKey: Buffer): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

/** JSON with object keys sorted at every depth, so the signed bytes never depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    // Code-unit order; an object's keys are unique, so two never compare equal.
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** Whether `signature` (base64) is the signature of the raw ed25519 `publicKey` over the document's canonical JSON. */
export function signedBy(document: unknown, signature: string, publicKey: Buffer): boolean {
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: publicKey.toString('base64url') },
    format: 'jwk'
  })
  return verify(null, Buffer.from(canonicalJson(document)), key, Buffer.from(signature, 'base64'))
}
