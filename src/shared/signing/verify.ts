// Verification of the key list, the catalog, component.json and the artifact it pins (ADR 0001 D3–D4).
// Pure functions over parsed documents: the caller parses with the schemas in ./documents first, and stores
// the last seen key list `version` and catalog `serial`.
import type { Catalog, Component, Envelope, KeyList, KeyRole } from './documents'
import { keyId, signedBy } from './keys'

/** Why a key list is rejected. */
export type KeyListRejection = 'bad_signature' | 'invalid_list' | 'replayed' | 'expired'
/** Why a catalog is rejected. */
export type CatalogRejection = 'unknown_key' | 'wrong_role' | 'bad_signature' | 'rollback' | 'expired'
/** Why a component.json is rejected. */
export type ComponentRejection = 'unknown_key' | 'wrong_role' | 'wrong_scope' | 'bad_signature'
/** Why a downloaded artifact is rejected. */
export type ArtifactRejection = 'size_mismatch' | 'sha256_mismatch'

/**
 * Checks `keys.json` against its root signature (`keys.json.sig`, base64): signed by one of the embedded
 * root keys (root and next root), well formed (unique ids, each the id of its raw 32-byte public key), not
 * older than the last seen `version`, not expired at `now`.
 */
export function verifyKeyList(
  list: KeyList,
  signature: string,
  rootKeys: readonly Buffer[],
  lastSeenVersion: number,
  now: Date
): 'ok' | KeyListRejection {
  if (!rootKeys.some((key) => signedBy(list, signature, key))) return 'bad_signature'
  if (!wellFormed(list)) return 'invalid_list'
  if (list.version < lastSeenVersion) return 'replayed'
  if (new Date(list.expires) <= now) return 'expired'
  return 'ok'
}

/** Whether every key id is unique and is the id of its entry's raw 32-byte public key. */
function wellFormed(list: KeyList): boolean {
  const ids = new Set(list.keys.map((entry) => entry.id))
  return (
    ids.size === list.keys.length &&
    list.keys.every((entry) => {
      const raw = Buffer.from(entry.publicKey, 'base64')
      return raw.length === 32 && keyId(raw) === entry.id
    })
  )
}

/** The envelope's signer if the key list names it with `role` and it signed `document`, else why not. */
function checkSigner(
  document: unknown,
  envelope: Envelope,
  list: KeyList,
  role: KeyRole
): KeyList['keys'][number] | 'unknown_key' | 'wrong_role' | 'bad_signature' {
  const key = list.keys.find((entry) => entry.id === envelope.keyId)
  if (!key) return 'unknown_key'
  if (key.role !== role) return 'wrong_role'
  if (!signedBy(document, envelope.signature, Buffer.from(key.publicKey, 'base64'))) return 'bad_signature'
  return key
}

/**
 * Checks `catalog.json` against its envelope: signed by a catalog key the verified key list names, a
 * `serial` no lower than the last seen one (equal is accepted), not expired at `now`.
 */
export function verifyCatalog(
  catalog: Catalog,
  envelope: Envelope,
  list: KeyList,
  lastSeenSerial: number,
  now: Date
): 'ok' | CatalogRejection {
  const signer = checkSigner(catalog, envelope, list, 'catalog')
  if (typeof signer === 'string') return signer
  if (catalog.serial < lastSeenSerial) return 'rollback'
  if (new Date(catalog.expires) <= now) return 'expired'
  return 'ok'
}

/** Checks `component.json` against its envelope: signed by a component key the key list scopes to `publisher`. */
export function verifyComponent(
  component: Component,
  envelope: Envelope,
  list: KeyList,
  publisher: string
): 'ok' | ComponentRejection {
  const signer = checkSigner(component, envelope, list, 'component')
  if (typeof signer === 'string') return signer
  if (signer.scope !== publisher) return 'wrong_scope'
  return 'ok'
}

/** Checks a downloaded artifact's measured size and sha256 against what its signed component.json pins. */
export function verifyArtifact(
  component: Component,
  measured: { sha256: string; size: number }
): 'ok' | ArtifactRejection {
  if (measured.size !== component.size) return 'size_mismatch'
  if (measured.sha256 !== component.sha256) return 'sha256_mismatch'
  return 'ok'
}
