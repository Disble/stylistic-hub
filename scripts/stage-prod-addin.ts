// Copies the bundled add-in into out/addin for the installer, under the production add-in id, so the installed
// hub never shares Word's sideload entry (and its debugger flags) with development.
// Usage: bun scripts/stage-prod-addin.ts (part of `bun run dist`)
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeAddinDocument } from './addin-document'

/** The add-in id Word knows the installed hub's add-in by; development keeps stylistic-addon's own id. */
const PRODUCTION_ID = '5d0c6b1e-7f2a-4c3e-9b8d-1a2f3e4c5d6e'
/** What `bun run addin:bundle` produced. */
const source = resolve('resources/addin')
/** What electron-builder packs as `resources/addin`. */
const target = resolve('out/addin')

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
/** The staged manifest, rewritten to the production id. */
const manifestFile = join(target, 'manifest.xml')
/** The manifest as bundled for development. */
const manifest = readFileSync(manifestFile, 'utf8')
/** The same manifest under the production id. */
const production = manifest.replace(/<Id>[^<]+<\/Id>/, `<Id>${PRODUCTION_ID}</Id>`)
if (production === manifest) throw new Error(`The add-in manifest has no <Id>: ${manifestFile}`)
writeFileSync(manifestFile, production)
writeAddinDocument(target)
console.log(`Staged the production add-in (${PRODUCTION_ID}) into ${target}`)
