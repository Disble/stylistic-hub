import { describe, expect, it } from 'vitest'
import type { Component } from '../../src/shared/signing/documents'
import { catalogEntry, upsertEntry } from './catalog-entry'
import type { CatalogSource } from './sign-catalog'

/** The release folder of the hub 1.1.1-beta.2. */
const RELEASE = 'https://github.com/Disble/stylistic-hub/releases/download/hub-v1.1.1-beta.2/'

/** The hub 1.1.1-beta.2's component.json, as its release publishes it. */
const COMPONENT: Component = {
  id: 'stylistic-hub',
  kind: 'hub',
  version: '1.1.1-beta.2',
  channel: 'beta',
  sha256: 'c'.repeat(64),
  size: 127890367,
  maxUncompressedSize: 127890367,
  requires: {},
  provides: {},
  releaseNotes: 'https://github.com/Disble/stylistic-hub/releases/tag/hub-v1.1.1-beta.2'
}

/** Every asset of that release. */
const ASSETS = ['StylisticHub-Setup-1.1.1-beta.2.exe', 'component.json', 'component.json.sig']

/** The stable hub 1.0.0 entry the catalog already lists. */
const STABLE = {
  id: 'stylistic-hub',
  kind: 'hub',
  publisher: 'stylistic-hub',
  channel: 'stable' as const,
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  size: 10,
  artifactUrl: 'https://example.com/StylisticHub-Setup-1.0.0.exe',
  componentUrl: 'https://example.com/component.json',
  rolloutPercent: 100,
  blocked: []
}

/** The entry `catalogEntry` builds for the hub 1.1.1-beta.2. */
const BETA = catalogEntry({
  component: COMPONENT,
  publisher: 'stylistic-hub',
  release: RELEASE,
  assets: ASSETS
})

describe('catalogEntry', () => {
  it('builds the entry from the signed component.json and the one artifact of its release', () => {
    expect(BETA).toEqual({
      id: 'stylistic-hub',
      kind: 'hub',
      publisher: 'stylistic-hub',
      channel: 'beta',
      version: '1.1.1-beta.2',
      sha256: 'c'.repeat(64),
      size: 127890367,
      artifactUrl: `${RELEASE}StylisticHub-Setup-1.1.1-beta.2.exe`,
      componentUrl: `${RELEASE}component.json`,
      rolloutPercent: 100,
      blocked: []
    })
  })

  it('refuses a release without exactly one artifact beside component.json and its signature', () => {
    const build = (assets: string[]) => () =>
      catalogEntry({ component: COMPONENT, publisher: 'stylistic-hub', release: RELEASE, assets })

    expect(build(['component.json', 'component.json.sig'])).toThrow(/exactly one artifact/)
    expect(build([...ASSETS, 'notes.txt'])).toThrow(/exactly one artifact/)
  })
})

describe('upsertEntry', () => {
  it('adds the entry of a channel the catalog does not list yet, keeping the other entries', () => {
    const source: CatalogSource = { components: [STABLE] }

    expect(upsertEntry(source, BETA)).toEqual({ changed: true, source: { components: [STABLE, BETA] } })
    expect(source.components).toEqual([STABLE])
  })

  it('replaces the entry of the same id and channel in place, keeping its rollout and pulled versions', () => {
    const older = {
      ...BETA,
      version: '1.1.1-beta.1',
      sha256: 'b'.repeat(64),
      rolloutPercent: 20,
      blocked: ['1.1.0-beta.3']
    }

    expect(upsertEntry({ components: [older, STABLE] }, BETA)).toEqual({
      changed: true,
      source: { components: [{ ...BETA, rolloutPercent: 20, blocked: ['1.1.0-beta.3'] }, STABLE] }
    })
  })

  it('changes nothing when the catalog already lists that release', () => {
    const source: CatalogSource = { components: [STABLE, { ...BETA, rolloutPercent: 50 }] }

    expect(upsertEntry(source, BETA)).toEqual({ changed: false, source })
  })
})
