// The signed documents of component delivery (ADR 0001 D2–D4) as zod schemas (docs/signed-releases.md).
// Signed documents are loose objects: fields a later version adds survive parsing, so the signature, which
// covers every received field, still verifies. Formats evolve only by adding optional fields.
import { z } from 'zod'

/** Component ids, kinds, publishers and key scopes. */
const name = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/)
/** A release version: semver, optionally a beta prerelease. */
const version = z.string().regex(/^\d+\.\d+\.\d+(-beta\.\d+)?$/)
/** A key id: the first 16 hex characters of the sha256 of the raw public key. */
const keyIdPattern = z.string().regex(/^[0-9a-f]{16}$/)
/** A lowercase hex sha256. */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
/** A size in bytes. */
const bytes = z.number().int().nonnegative()
/** The release stream a version belongs to. */
const channel = z.enum(['stable', 'beta'])

/** What a key may sign: the root key signs the key list, the others what their role names. */
const keyRoleSchema = z.enum(['root', 'catalog', 'component'])

/** `keys.json`: the online keys, versioned and expiring so an old list cannot be replayed. */
export const keyListSchema = z.looseObject({
  version: z.number().int().positive(),
  expires: z.iso.datetime(),
  keys: z.array(
    z.looseObject({
      id: keyIdPattern,
      role: keyRoleSchema,
      /** For component keys: the repository whose release streams the key signs. */
      scope: name.optional(),
      /** The raw 32-byte ed25519 public key, base64. */
      publicKey: z.base64()
    })
  )
})

/** `<file>.sig` of a catalog or component.json: who signed it and the signature over its canonical JSON. */
export const envelopeSchema = z.object({ keyId: keyIdPattern, signature: z.base64() })

/** `component.json`: what one release artifact is, pinned by its sha256 (D2). */
export const componentSchema = z.looseObject({
  id: name,
  kind: name,
  version,
  channel,
  sha256,
  size: bytes,
  maxUncompressedSize: bytes,
  requires: z.record(z.string(), z.unknown()),
  provides: z.record(z.string(), z.unknown()),
  releaseNotes: z.url()
})

/** `catalog/catalog.source.json`: the components the hub offers, changed by reviewed pull request. */
const catalogSourceSchema = z.looseObject({
  components: z.array(
    z.looseObject({
      id: name,
      kind: name,
      publisher: name,
      channel,
      version,
      sha256,
      size: bytes,
      artifactUrl: z.url(),
      componentUrl: z.url(),
      rolloutPercent: z.number().int().min(0).max(100),
      blocked: z.array(version)
    })
  )
})

/** `catalog.json`: the source plus a `serial` (Unix seconds at signing) and an `expires` (D4). */
export const catalogSchema = catalogSourceSchema.extend({
  serial: z.number().int().nonnegative(),
  expires: z.iso.datetime()
})

/** What a key may sign. */
export type KeyRole = z.infer<typeof keyRoleSchema>
/** A parsed `keys.json`. */
export type KeyList = z.infer<typeof keyListSchema>
/** A parsed signature envelope. */
export type Envelope = z.infer<typeof envelopeSchema>
/** A parsed `component.json`. */
export type Component = z.infer<typeof componentSchema>
/** A parsed `catalog.json`. */
export type Catalog = z.infer<typeof catalogSchema>
