// The catalog-only hub's Word directory: the loader script plus the trigger document, outside any content bundle.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCTION_ADDIN_ID } from './addin-document'
import { stageWord } from './stage-word'

/** Every directory a test made, removed once the file is done. */
const scratches: string[] = []
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A scratch directory for one test. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stage-word-'))
  scratches.push(dir)
  return dir
}

/** The production add-in id written into a staged trigger document. */
function triggerId(target: string): string {
  return new AdmZip(join(target, 'Stylistic.docx')).readAsText('word/webextensions/webextension.xml')
}

describe('stageWord', () => {
  it('stages the loader script and the trigger document with the production id', () => {
    const target = join(scratch(), 'word')

    const staged = stageWord(target)

    expect(staged).toBe(target)
    expect(readFileSync(join(target, 'word-session.ps1'), 'utf8')).toBe(
      readFileSync('resources/word/word-session.ps1', 'utf8')
    )
    expect(triggerId(target)).toContain(PRODUCTION_ADDIN_ID)
  })

  it('stages again over a previous run', () => {
    const target = scratch()

    stageWord(target)
    stageWord(target)

    expect(triggerId(target)).toContain(PRODUCTION_ADDIN_ID)
  })

  it('stages out/word when the release script runs it, taking no path from the command line', () => {
    const existed = existsSync('out/word')

    const stdout = execFileSync('bun', ['scripts/stage-word.ts'], { encoding: 'utf8' })

    expect(stdout).toContain(PRODUCTION_ADDIN_ID)
    expect(stdout).toContain(join(process.cwd(), 'out', 'word'))
    expect(triggerId('out/word')).toContain(PRODUCTION_ADDIN_ID)
    if (!existed) rmSync('out/word', { recursive: true, force: true })
  })
})
