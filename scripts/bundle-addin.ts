// Builds stylistic-addon and copies its output into resources/addin, where the hub serves it from.
// Usage: bun run addin:bundle [path to stylistic-addon]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'

/** The stylistic-addon checkout to build. */
const addon = resolve(process.argv[2] ?? '../stylistic-addon')
/** Where the hub serves the add-in from in development and packs it from. */
const target = resolve('resources/addin')

execFileSync('bun', ['run', 'build:hub'], {
  cwd: addon,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (!existsSync(join(addon, 'dist', 'manifest.xml'))) throw new Error(`No dist/manifest.xml in ${addon}`)
rmSync(target, { recursive: true, force: true })
// Source maps stay behind: the hub would serve them and they only add size to the installer.
cpSync(join(addon, 'dist'), target, { recursive: true, filter: (source) => !source.endsWith('.map') })
// Word only loads a sideloaded add-in when a document refers to it, so the hub opens this one. Same template
// and placeholders as office-addin-dev-settings' generateSideloadFile (MIT, see scripts/templates), without its
// Teams toolkit and telemetry dependencies.
/** The bundled add-in manifest, source of the add-in id and version. */
const manifest = readFileSync(join(target, 'manifest.xml'), 'utf8')
/** Reads one element of the manifest; the document must name the add-in exactly. */
const tag = (name: string) => {
  const value = new RegExp(`<${name}>([^<]+)</${name}>`).exec(manifest)?.[1]
  if (!value) throw new Error(`The add-in manifest has no <${name}>`)
  return value
}
/** The Word document template whose web extension part names the add-in. */
const document = new AdmZip(resolve('scripts/templates/WordDocumentWithTaskPane.docx'))
/** The part that tells Word which add-in to load and open as a task pane. */
const part = 'word/webextensions/webextension.xml'
document.updateFile(
  part,
  Buffer.from(
    document
      .readAsText(part)
      .replace(/00000000-0000-0000-0000-000000000000/g, tag('Id'))
      .replace(/1\.0\.0\.0/g, tag('Version'))
  )
)
document.writeZip(join(target, 'Stylistic.docx'))
console.log(`Bundled ${addon} into ${target}`)
