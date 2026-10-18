import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { describe, expect, it } from 'vitest'
import { componentSchema, envelopeSchema } from '../../src/shared/signing/documents'
import { verifyArtifact, verifyComponent } from '../../src/shared/signing/verify'
import { entryFor, generateKey } from '../keys/key-list'
import { packComponent, packFile } from './pack-component'

describe('packComponent', () => {
  it('zips a directory and writes a component.json, signed, that pins the zip', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pack-component-'))
    const dir = join(scratch, 'server')
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(join(dir, 'entry.js'), 'console.log(1)\n')
    writeFileSync(join(dir, 'lib', 'a.js'), 'export {}\n')
    const key = generateKey()
    const out = join(scratch, 'release')

    const { zip } = await packComponent(
      {
        dir,
        out,
        id: 'server',
        kind: 'server',
        version: '0.2.0-beta.1',
        channel: 'beta',
        requires: {},
        provides: { api: ['v1'], schemaVersion: 5, minReaderSchema: 5 },
        releaseNotes: 'https://example.com/notes'
      },
      key.privateKey
    )

    const bytes = readFileSync(zip)
    const component = componentSchema.parse(JSON.parse(readFileSync(join(out, 'component.json'), 'utf8')))
    const envelope = envelopeSchema.parse(JSON.parse(readFileSync(join(out, 'component.json.sig'), 'utf8')))
    const list = {
      version: 1,
      expires: '2099-01-01T00:00:00.000Z',
      keys: [entryFor(key.publicKey, 'component', 'stylistic-hub')]
    }
    expect(zip).toBe(join(out, 'server-0.2.0-beta.1.zip'))
    expect(new AdmZip(zip).getEntries().map((entry) => entry.entryName)).toEqual(['entry.js', 'lib/a.js'])
    expect(component).toMatchObject({ id: 'server', channel: 'beta', maxUncompressedSize: 25 })
    expect(verifyArtifact(component, { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length })).toBe('ok')
    expect(verifyComponent(component, envelope, list, 'stylistic-hub')).toBe('ok')
  })

  it('describes a single file, such as the hub installer, with a signed component.json that pins it', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'pack-file-'))
    const installer = join(scratch, 'StylisticHub-Setup-0.2.0.exe')
    writeFileSync(installer, Buffer.from('MZ installer bytes'))
    const key = generateKey()
    const out = join(scratch, 'release')

    const component = packFile(
      {
        file: installer,
        out,
        id: 'stylistic-hub',
        kind: 'hub',
        version: '0.2.0',
        channel: 'stable',
        requires: {},
        provides: {},
        releaseNotes: 'https://github.com/Disble/stylistic-hub/releases/tag/hub-v0.2.0'
      },
      key.privateKey
    )

    const bytes = readFileSync(installer)
    const written = componentSchema.parse(JSON.parse(readFileSync(join(out, 'component.json'), 'utf8')))
    const envelope = envelopeSchema.parse(JSON.parse(readFileSync(join(out, 'component.json.sig'), 'utf8')))
    const list = {
      version: 1,
      expires: '2099-01-01T00:00:00.000Z',
      keys: [entryFor(key.publicKey, 'component', 'stylistic-hub')]
    }
    expect(written).toEqual(component)
    expect(written).toEqual({
      id: 'stylistic-hub',
      kind: 'hub',
      version: '0.2.0',
      channel: 'stable',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      maxUncompressedSize: bytes.length,
      requires: {},
      provides: {},
      releaseNotes: 'https://github.com/Disble/stylistic-hub/releases/tag/hub-v0.2.0'
    })
    expect(verifyComponent(written, envelope, list, 'stylistic-hub')).toBe('ok')
  })
})
