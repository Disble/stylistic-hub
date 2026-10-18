import { describe, expect, it } from 'vitest'
import { catalogSchema } from '../../src/shared/signing/documents'
import { verifyCatalog } from '../../src/shared/signing/verify'
import { createKeyList, entryFor, generateKey } from '../keys/key-list'
import { signCatalog, type CatalogSource } from './sign-catalog'

/** A catalog source with one entry. */
const SOURCE: CatalogSource = {
  components: [
    {
      id: 'server',
      kind: 'server',
      publisher: 'stylistic-hub',
      channel: 'stable',
      version: '0.2.0',
      sha256: 'a'.repeat(64),
      size: 10,
      artifactUrl: 'https://example.com/server-0.2.0.zip',
      componentUrl: 'https://example.com/component.json',
      rolloutPercent: 100,
      blocked: []
    }
  ]
}

describe('signCatalog', () => {
  it('stamps the serial (Unix seconds) and an expiry 14 days ahead, signed by the catalog key', () => {
    const key = generateKey()
    const now = new Date('2026-10-18T12:00:00.500Z')

    const { catalog } = signCatalog(SOURCE, key.privateKey, now)

    expect(catalog.serial).toBe(Math.floor(now.getTime() / 1000))
    expect(catalog.expires).toBe('2026-11-01T12:00:00.500Z')
  })

  it('re-signing an unchanged source yields a higher serial, the same components and a valid signature', () => {
    const key = generateKey()
    const list = createKeyList([entryFor(key.publicKey, 'catalog')])
    const first = signCatalog(SOURCE, key.privateKey, new Date('2026-10-18T05:00:00.000Z'))

    const second = signCatalog(SOURCE, key.privateKey, new Date('2026-10-19T05:00:00.000Z'))

    expect(second.catalog.serial).toBeGreaterThan(first.catalog.serial)
    expect(second.catalog.components).toEqual(first.catalog.components)
    expect(
      verifyCatalog(
        catalogSchema.parse(second.catalog),
        second.envelope,
        list,
        first.catalog.serial,
        new Date('2026-10-19T06:00:00.000Z')
      )
    ).toBe('ok')
  })
})
