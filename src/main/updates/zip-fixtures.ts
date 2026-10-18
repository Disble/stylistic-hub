// Zips for the update engine's tests, written by yazl as scripts/release/pack-component.ts writes them, and the
// byte patch that gives an entry the malicious name yazl itself refuses to write.
import { ZipFile } from 'yazl'

/** One file of a fixture zip; `name` may be a placeholder patched later, `mode` sets the Unix mode. */
export interface ZipItem {
  name: string
  data: string
  mode?: number
}

/** A zip of `items` written by yazl, as pack-component.ts writes it. */
export async function makeZip(items: ZipItem[]): Promise<Buffer> {
  const zipfile = new ZipFile()
  for (const { name, data, mode } of items) {
    if (name.endsWith('/')) zipfile.addEmptyDirectory(name.slice(0, -1))
    else zipfile.addBuffer(Buffer.from(data), name, mode ? { mode } : {})
  }
  zipfile.end()
  const chunks: Buffer[] = []
  for await (const chunk of zipfile.outputStream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/**
 * Replaces every occurrence of the entry name `from` with `to` (same byte length) in the local headers and the
 * central directory: yazl refuses to write the malicious names a real attacker's zip would hold.
 */
export function patchName(zip: Buffer, from: string, to: string): Buffer {
  if (from.length !== to.length) throw new Error('patchName needs names of equal length')
  const out = Buffer.from(zip)
  for (let at = out.indexOf(from); at !== -1; at = out.indexOf(from, at + 1)) out.write(to, at, 'latin1')
  return out
}
