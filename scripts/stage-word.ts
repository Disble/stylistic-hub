// Stages the Word directory the installer packs: the loader script plus the trigger document that makes Word
// load the sideloaded add-in, outside any add-in content bundle. The trigger carries the production add-in id,
// which signed module releases kept, so the same trigger loads them (docs/addin-contract.md#modules).
// Usage: bun scripts/stage-word.ts (part of `bun run dist`)
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PRODUCTION_ADDIN_ID, writeTriggerDocument } from './addin-document'

/** Where electron-builder packs the Word directory from (`word` in the installed hub's resources). */
const DEFAULT_TARGET = 'out/word'

/**
 * Writes the loader and the trigger document into `target` and returns the directory it used. The destination
 * is a parameter of the build, never of a command line: the release scripts and the tests choose it in code.
 */
export function stageWord(target: string): string {
  const out = resolve(target)
  mkdirSync(out, { recursive: true })
  copyFileSync(resolve('resources/word/word-session.ps1'), join(out, 'word-session.ps1'))
  writeTriggerDocument(out, PRODUCTION_ADDIN_ID)
  console.log(`Staged the Word loader and its trigger document (${PRODUCTION_ADDIN_ID}) into ${out}`)
  return out
}

// Bun runs this file as the command in `bun run dist`; a test imports it instead and stages into its own
// scratch directory, so a test never decides where the release directory goes.
/** The file name Bun reports when it runs this module as the command, in `bun run dist`. */
const command = (process.argv[1] ?? '').split(/[\\/]/).pop()
if (command === 'stage-word.ts') stageWord(DEFAULT_TARGET)
