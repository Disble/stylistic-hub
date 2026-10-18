// The catalog-only hub's Word directory: the loader script plus the trigger document, outside any content bundle.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCTION_ADDIN_ID } from './addin-document'

/** Every directory a test made, removed once the file is done. */
const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Runs `bun scripts/stage-word.ts <target>` and returns its stdout. */
function stage(target: string): string {
  return execFileSync('bun', ['scripts/stage-word.ts', target], { encoding: 'utf8' })
}

describe('stage-word', () => {
  it('stages the loader script and the trigger document with the production id', () => {
    const target = join(mkdtempSync(join(tmpdir(), 'stage-word-')), 'word')
    scratches.push(join(target, '..'))

    const stdout = stage(target)

    expect(stdout).toContain(PRODUCTION_ADDIN_ID)
    expect(stdout).toContain(target)
    expect(readFileSync(join(target, 'word-session.ps1'), 'utf8')).toBe(
      readFileSync('resources/word/word-session.ps1', 'utf8')
    )
    const reference = new AdmZip(join(target, 'Stylistic.docx')).readAsText(
      'word/webextensions/webextension.xml'
    )
    expect(reference).toContain(PRODUCTION_ADDIN_ID)
  })

  it('stages again over a previous run', () => {
    const target = mkdtempSync(join(tmpdir(), 'stage-word-'))
    scratches.push(target)

    stage(target)
    const stdout = stage(target)

    expect(stdout).toContain(PRODUCTION_ADDIN_ID)
    expect(
      new AdmZip(join(target, 'Stylistic.docx'))
        .readAsText('word/webextensions/webextension.xml')
        .includes(PRODUCTION_ADDIN_ID)
    ).toBe(true)
  })
})
