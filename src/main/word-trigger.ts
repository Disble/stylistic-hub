// The document the Word session loader shows Word (word-session.ts), so that Word loads the sideloaded add-in.
// Word refuses a sideloaded add-in ("This add-in is no longer available") when the document's
// `<we:reference version>` is not the `<Version>` of the manifest registered for its id
// (odd/tasks/word-trigger-version.md), so the trigger is rewritten for each module version Word is registered
// with. adm-zip is the zip library the build scripts already use (scripts/addin-document.ts); it is bundled
// into the main process.
import AdmZip from 'adm-zip'
import { renameSync, rmSync, writeFileSync } from 'node:fs'

/** The part that tells Word which add-in to load and open as a task pane. */
const PART = 'word/webextensions/webextension.xml'

/** The version attribute of the add-in reference. */
const REFERENCE_VERSION = /(<we:reference\b[^>]*\bversion=")[^"]*"/

/**
 * Writes `output`: the `template` trigger document referring to the `<Version>` of `manifest`. Throws, naming
 * what is missing, when the manifest has no version or the template no add-in reference.
 */
export function writeWordTrigger(template: string, manifest: string, output: string): void {
  const version = /<Version>([^<]+)<\/Version>/.exec(manifest)?.[1]
  if (!version) throw new Error('its manifest has no <Version>')
  const document = new AdmZip(template)
  const part = document.readAsText(PART)
  if (!REFERENCE_VERSION.test(part)) throw new Error(`${PART} has no <we:reference version="…">`)
  document.updateFile(PART, Buffer.from(part.replace(REFERENCE_VERSION, `$1${version}"`)))
  // Written beside and renamed, so the loader never opens a half-written document; on failure the previous
  // trigger stays and nothing staged is left. writeFileSync, not adm-zip's writeZip, which returns quietly
  // when it cannot write.
  const staged = `${output}.tmp`
  try {
    writeFileSync(staged, document.toBuffer())
    renameSync(staged, output)
  } catch (error) {
    rmSync(staged, { recursive: true, force: true })
    throw error
  }
}
