// Writes Stylistic.docx next to an add-in manifest. Word only loads a sideloaded add-in when a document refers
// to it, so the hub shows Word this one once per session. Same template and placeholders as
// office-addin-dev-settings' generateSideloadFile (MIT, see scripts/templates), without its Teams toolkit and
// telemetry dependencies.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'

/** The part that tells Word which add-in to load and open as a task pane. */
const PART = 'word/webextensions/webextension.xml'

/** Writes `<addinDir>/Stylistic.docx` for the manifest in `addinDir`. */
export function writeAddinDocument(addinDir: string): void {
  const manifest = readFileSync(join(addinDir, 'manifest.xml'), 'utf8')
  const tag = (name: string) => {
    const value = new RegExp(`<${name}>([^<]+)</${name}>`).exec(manifest)?.[1]
    if (!value) throw new Error(`The add-in manifest has no <${name}>`)
    return value
  }
  const document = new AdmZip(resolve('scripts/templates/WordDocumentWithTaskPane.docx'))
  document.updateFile(
    PART,
    Buffer.from(
      document
        .readAsText(PART)
        .replace(/00000000-0000-0000-0000-000000000000/g, tag('Id'))
        .replace(/1\.0\.0\.0/g, tag('Version'))
    )
  )
  document.writeZip(join(addinDir, 'Stylistic.docx'))
}
