// Writes Stylistic.docx next to an add-in manifest. Word only loads a sideloaded add-in when a document refers
// to it, so the hub shows Word this one once per session. Same template and placeholders as
// office-addin-dev-settings' generateSideloadFile (MIT, see scripts/templates), without its Teams toolkit and
// telemetry dependencies.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import AdmZip from 'adm-zip'

/**
 * The add-in id Word knows the installed hub's add-in by. The catalog-only installer stages the trigger
 * document for this id (scripts/stage-word.ts), and signed module releases kept it, so the same trigger
 * loads them (docs/addin-contract.md#modules).
 */
export const PRODUCTION_ADDIN_ID = '5d0c6b1e-7f2a-4c3e-9b8d-1a2f3e4c5d6e'

/** The version a staged trigger refers to; Word loads the registered add-in by id. */
export const TRIGGER_VERSION = '1.0.0.0'

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

/**
 * Writes `<dir>/Stylistic.docx` for the given add-in id and version, outside any content bundle: the
 * catalog-only hub's trigger, staged by scripts/stage-word.ts with the production id. Returns its path.
 */
export function writeTriggerDocument(
  dir: string,
  id: string = PRODUCTION_ADDIN_ID,
  version: string = TRIGGER_VERSION
): string {
  const document = new AdmZip(resolve('scripts/templates/WordDocumentWithTaskPane.docx'))
  document.updateFile(
    PART,
    Buffer.from(
      document
        .readAsText(PART)
        .replace(/00000000-0000-0000-0000-000000000000/g, id)
        .replace(/1\.0\.0\.0/g, version)
    )
  )
  const output = join(dir, 'Stylistic.docx')
  document.writeZip(output)
  return output
}
