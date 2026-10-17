// Copies the bundled add-in into out/addin for the installer, under the production add-in id, so the installed
// hub never shares Word's sideload entry (and its debugger flags) with development. It also stamps the identity the
// hub ships with (resources/addin-shell/manifest.json): the bundled manifest still carries the sample strings the
// add-on project generated it from, and those texts are the add-on's to own later. Until they do, this shell is what
// makes the installed extension read as Stylistic instead of "Commands Group" / "Show Task Pane".
// Usage: bun scripts/stage-prod-addin.ts (part of `bun run dist`)
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { writeAddinDocument } from './addin-document'

/** The add-in id Word knows the installed hub's add-in by; development keeps stylistic-addon's own id. */
const PRODUCTION_ID = '5d0c6b1e-7f2a-4c3e-9b8d-1a2f3e4c5d6e'
/** The identity the hub ships with: manifest resource name to the text it must carry. */
const SHELL = resolve('resources/addin-shell/manifest.json')
/** What `bun run addin:bundle` produced. */
const source = resolve('resources/addin')
/** What electron-builder packs as `resources/addin`. */
const target = resolve('out/addin')

/** Replaces the DefaultValue of the manifest resource `name`, which must be there. */
function setResource(manifest: string, name: string, value: string): string {
  const residence = name.includes('.')
    ? `<bt:String id="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`
    : `<${name}`
  const pattern = new RegExp(`${residence} DefaultValue="[^"]*"`)
  if (!pattern.test(manifest)) throw new Error(`The add-in manifest has no ${name}`)
  return manifest.replace(pattern, (match) =>
    match.replace(/DefaultValue="[^"]*"/, `DefaultValue="${value}"`)
  )
}

rmSync(target, { recursive: true, force: true })
cpSync(source, target, { recursive: true })
/** The staged manifest, rewritten to the production id and stamped with the shipped identity. */
const manifestFile = join(target, 'manifest.xml')
/** The manifest as bundled for development. */
const manifest = readFileSync(manifestFile, 'utf8')
/** The same manifest under the production id. */
let staged = manifest.replace(/<Id>[^<]+<\/Id>/, `<Id>${PRODUCTION_ID}</Id>`)
if (staged === manifest) throw new Error(`The add-in manifest has no <Id>: ${manifestFile}`)
for (const [name, value] of Object.entries(
  JSON.parse(readFileSync(SHELL, 'utf8')) as Record<string, string>
)) {
  staged = setResource(staged, name, value)
}
writeFileSync(manifestFile, staged)
writeAddinDocument(target)
console.log(`Staged the production add-in (${PRODUCTION_ID}) into ${target}`)
