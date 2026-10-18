// Packs a directory as a signed component release (docs/signed-releases.md): `<id>-<version>.zip`, its
// `component.json` and `component.json.sig`, signed with the PKCS#8 PEM in STYLISTIC_COMPONENT_KEY. Generic, so
// the add-in packs with the same format. Usage:
//   bun scripts/release/pack-component.ts --dir <dir> --out <dir> --id <id> --kind <kind> --version <version>
//     --channel <stable|beta> --release-notes <url> [--requires <json>] [--provides <json>]
import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash, type KeyObject } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { ZipFile } from 'yazl'
import { componentSchema, type Component } from '../../src/shared/signing/documents'
import { keyFromEnv, signEnvelope } from '../keys/key-list'

/** What `component.json` says about a release besides what packing measures. */
export type PackOptions = Pick<
  Component,
  'id' | 'kind' | 'version' | 'channel' | 'requires' | 'provides' | 'releaseNotes'
> & {
  /** The directory whose files the zip holds, at its root. */
  dir: string
  /** Where the zip, `component.json` and `component.json.sig` are written. */
  out: string
}

/** Zips `options.dir` and writes the signed `component.json` beside the zip. */
export async function packComponent(
  { dir, out, ...release }: PackOptions,
  privateKey: KeyObject
): Promise<{ zip: string; component: Component }> {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  const zipfile = new ZipFile()
  let uncompressed = 0
  for (const file of files) {
    zipfile.addFile(file, relative(dir, file).split(sep).join('/'))
    uncompressed += statSync(file).size
  }
  zipfile.end()
  mkdirSync(out, { recursive: true })
  const zip = join(out, `${release.id}-${release.version}.zip`)
  await pipeline(zipfile.outputStream, createWriteStream(zip))

  const bytes = readFileSync(zip)
  const component = componentSchema.parse({
    ...release,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    maxUncompressedSize: uncompressed
  })
  writeFileSync(join(out, 'component.json'), `${JSON.stringify(component, null, 2)}\n`)
  writeFileSync(
    join(out, 'component.json.sig'),
    `${JSON.stringify(signEnvelope(component, privateKey), null, 2)}\n`
  )
  return { zip, component }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      out: { type: 'string' },
      id: { type: 'string' },
      kind: { type: 'string' },
      version: { type: 'string' },
      channel: { type: 'string' },
      'release-notes': { type: 'string' },
      requires: { type: 'string', default: '{}' },
      provides: { type: 'string', default: '{}' }
    }
  })
  const { zip, component } = await packComponent(
    {
      dir: values.dir ?? '',
      out: values.out ?? '',
      id: values.id ?? '',
      kind: values.kind ?? '',
      version: values.version ?? '',
      channel: values.channel as Component['channel'],
      releaseNotes: values['release-notes'] ?? '',
      requires: JSON.parse(values.requires) as Component['requires'],
      provides: JSON.parse(values.provides) as Component['provides']
    },
    keyFromEnv('STYLISTIC_COMPONENT_KEY')
  )
  console.log(`${zip}: ${component.size} bytes, sha256 ${component.sha256}`)
}
