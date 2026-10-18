// The trigger document next to an add-in manifest, and the standalone trigger for the catalog-only hub.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCTION_ADDIN_ID, writeAddinDocument, writeTriggerDocument } from './addin-document'

/** A manifest with this id and version. */
const manifest = (id: string, version: string) =>
  `<OfficeApp><Id>${id}</Id><Version>${version}</Version></OfficeApp>`

/** Every directory a test made, removed once the file is done. */
const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A fresh directory holding a manifest with `manifest()`. */
function addinDir(id = 'b821964a-4f1e-4939-83c8-0ddba48f3dff', version = '1.0.0.0'): string {
  const dir = mkdtempSync(join(tmpdir(), 'addin-document-'))
  scratches.push(dir)
  writeFileSync(join(dir, 'manifest.xml'), manifest(id, version))
  return dir
}

/** The webextension reference of the trigger document in `dir`. */
function referenceOf(dir: string): string {
  return new AdmZip(join(dir, 'Stylistic.docx')).readAsText('word/webextensions/webextension.xml')
}

describe('writeAddinDocument', () => {
  it('writes the trigger document for the manifest next to it', () => {
    const dir = addinDir('b821964a-4f1e-4939-83c8-0ddba48f3dff', '2.0.0.0')

    writeAddinDocument(dir)

    const reference = referenceOf(dir)
    expect(reference).toContain('b821964a-4f1e-4939-83c8-0ddba48f3dff')
    expect(reference).toContain('2.0.0.0')
    expect(reference).not.toContain('00000000-0000-0000-0000-000000000000')
  })

  it('refuses a manifest without an id instead of writing a trigger for an empty one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'addin-document-'))
    scratches.push(dir)
    writeFileSync(join(dir, 'manifest.xml'), '<OfficeApp></OfficeApp>')

    expect(() => writeAddinDocument(dir)).toThrow(/no <Id>/)
  })
})

describe('writeTriggerDocument', () => {
  it('writes the trigger document with the production id the signed module releases carry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'addin-document-'))
    scratches.push(dir)

    const document = writeTriggerDocument(dir)

    expect(document).toBe(join(dir, 'Stylistic.docx'))
    const reference = referenceOf(dir)
    expect(reference).toContain(PRODUCTION_ADDIN_ID)
    expect(reference).not.toContain('00000000-0000-0000-0000-000000000000')
  })

  it('writes the given id and version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'addin-document-'))
    scratches.push(dir)

    writeTriggerDocument(dir, '11111111-2222-3333-4444-555555555555', '3.1.0.0')

    const reference = referenceOf(dir)
    expect(reference).toContain('11111111-2222-3333-4444-555555555555')
    expect(reference).toContain('3.1.0.0')
  })

  it('uses the production id of the installed hub, which module releases kept', () => {
    expect(PRODUCTION_ADDIN_ID).toBe('5d0c6b1e-7f2a-4c3e-9b8d-1a2f3e4c5d6e')
    expect(readFileSync('scripts/stage-prod-addin.ts', 'utf8')).toContain(PRODUCTION_ADDIN_ID)
  })
})
