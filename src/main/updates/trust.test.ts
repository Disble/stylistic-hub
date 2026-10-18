import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { keyId } from '../../shared/signing/keys'
import { CATALOG_URL, ROOT_KEYS } from './trust'

/** A `keys/*.pub` file as committed. */
function pub(name: string): { id: string; publicKey: string } {
  return JSON.parse(readFileSync(new URL(`../../../keys/${name}`, import.meta.url), 'utf8'))
}

describe('embedded trust', () => {
  it('embeds the root and next root public keys from keys/', () => {
    expect(ROOT_KEYS.map((key) => key.toString('base64'))).toEqual([
      pub('root.pub').publicKey,
      pub('root-next.pub').publicKey
    ])
    expect(ROOT_KEYS.map((key) => keyId(key))).toEqual([pub('root.pub').id, pub('root-next.pub').id])
  })

  it('reads the catalog from the catalog release', () => {
    expect(CATALOG_URL).toBe('https://github.com/Disble/stylistic-hub/releases/download/catalog/')
  })
})
