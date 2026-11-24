import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeWordTrigger } from './word-trigger'

/** The part of a trigger document that names the add-in and its version. */
const PART = 'word/webextensions/webextension.xml'
/** A registered module manifest at version 1.2.0.0. */
const MANIFEST = '<OfficeApp><Id>module-id</Id><Version>1.2.0.0</Version></OfficeApp>'

/** A scratch directory per test. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'word-trigger-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Writes a template whose reference part is `reference`. */
function template(reference: string): string {
  const zip = new AdmZip()
  zip.addFile(PART, Buffer.from(reference))
  const file = join(dir, 'template.docx')
  zip.writeZip(file)
  return file
}

describe('writeWordTrigger', () => {
  it('refers the trigger to the manifest version and leaves no staged file behind', () => {
    const output = join(dir, 'Stylistic.docx')

    writeWordTrigger(
      template('<we:reference id="module-id" version="1.0.0.0" store="developer" />'),
      MANIFEST,
      output
    )

    expect(new AdmZip(output).readAsText(PART)).toBe(
      '<we:reference id="module-id" version="1.2.0.0" store="developer" />'
    )
    expect(existsSync(`${output}.tmp`)).toBe(false)
  })

  it('leaves the previous trigger and no staged file when it cannot write the next one', () => {
    const output = join(dir, 'Stylistic.docx')
    const good = template('<we:reference id="module-id" version="1.0.0.0" store="developer" />')
    writeWordTrigger(good, MANIFEST, output)
    const before = readFileSync(output)
    mkdirSync(`${output}.tmp`)
    writeFileSync(join(`${output}.tmp`, 'blocker'), '')

    expect(() => writeWordTrigger(good, MANIFEST.replace('1.2.0.0', '1.3.0.0'), output)).toThrow()
    expect(readFileSync(output)).toEqual(before)
  })

  it('names the missing manifest version and writes nothing', () => {
    const output = join(dir, 'Stylistic.docx')

    expect(() =>
      writeWordTrigger(template('<we:reference version="1.0.0.0" />'), '<OfficeApp></OfficeApp>', output)
    ).toThrow('its manifest has no <Version>')
    expect(existsSync(output)).toBe(false)
  })

  it('names the missing add-in reference and writes nothing', () => {
    const output = join(dir, 'Stylistic.docx')

    expect(() => writeWordTrigger(template('<we:webextension/>'), MANIFEST, output)).toThrow(
      'word/webextensions/webextension.xml has no <we:reference version="…">'
    )
    expect(existsSync(output)).toBe(false)
  })
})
