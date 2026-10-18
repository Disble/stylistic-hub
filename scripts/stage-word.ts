// Stages the Word directory the installer packs: the loader script plus the trigger document that makes Word
// load the sideloaded add-in, outside any add-in content bundle. The trigger carries the production add-in id,
// which signed module releases kept, so the same trigger loads them (docs/addin-contract.md#modules).
// Usage: bun scripts/stage-word.ts [target dir, default out/word] (part of `bun run dist`)
import { copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PRODUCTION_ADDIN_ID, writeTriggerDocument } from './addin-document'

/** Where electron-builder packs the Word directory from (`word` in the installed hub's resources). */
const target = resolve(process.argv[2] ?? 'out/word')

mkdirSync(target, { recursive: true })
copyFileSync(resolve('resources/word/word-session.ps1'), join(target, 'word-session.ps1'))
/** The staged trigger document; logged below with the production id it carries. */
const document = writeTriggerDocument(target, PRODUCTION_ADDIN_ID)
console.log(`Staged the Word loader and its trigger document (${PRODUCTION_ADDIN_ID}) into ${target}`)
void document
