// The signed list of online keys (docs/keys.md): the root key signs it, the hub trusts what it lists.
import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto'

/** What a key may sign: the root key signs the key list, the others what their role names. */
export type KeyRole = 'root' | 'catalog' | 'component'

/** One online key as the hub sees it. */
export interface KeyEntry {
  id: string
  role: KeyRole
  /** For component keys: the repository whose release streams the key signs. */
  scope?: string
  /** The raw 32-byte ed25519 public key, base64. */
  publicKey: string
}

/** `keys.json`: the online keys, versioned and expiring so an old list cannot be replayed. */
export interface KeyList {
  version: number
  expires: string
  keys: KeyEntry[]
}

/** How long a key list stays valid: re-signed every year, a month of margin for a late ceremony. */
const VALID_MONTHS = 13

/** A new ed25519 key pair. */
export function generateKey(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('ed25519')
}

/** The raw 32 bytes of an ed25519 public key. */
export function rawPublicKey(key: KeyObject): Buffer {
  const { x } = key.export({ format: 'jwk' })
  if (!x) throw new Error('Not an ed25519 public key')
  return Buffer.from(x, 'base64url')
}

/** A key's id: the first 16 hex characters of the sha256 of its raw public key. */
export function keyId(publicKey: Buffer): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 16)
}

/** JSON with object keys sorted at every depth, so the signed bytes never depend on key order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
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

/** Whether `signature` is the root key's signature over this exact key list. */
export function verifyKeyList(list: KeyList, signature: string, rootPublicKey: Buffer): boolean {
  const key = createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: rootPublicKey.toString('base64url') },
    format: 'jwk'
  })
  return verify(null, Buffer.from(canonicalJson(list)), key, Buffer.from(signature, 'base64'))
}
