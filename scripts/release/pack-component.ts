// Packs a directory as a signed component release (docs/signed-releases.md): `<id>-<version>.zip`, its
// `component.json` and `component.json.sig`, signed with the PKCS#8 PEM in STYLISTIC_COMPONENT_KEY. Generic, so
// the add-in packs with the same format. With `--file` instead of `--dir` it describes one file as it is (the
// hub's NSIS installer): no zip, and `maxUncompressedSize` is the file's size. Usage:
//   bun scripts/release/pack-component.ts (--dir <dir> | --file <file>) --out <dir> --id <id> --kind <kind>
//     --version <version> --channel <stable|beta> --release-notes <url> [--requires <json>] [--provides <json>]
import { createWriteStream, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash, type KeyObject } from 'node:crypto'
import { join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parseArgs } from 'node:util'
import { ZipFile } from 'yazl'
import { componentSchema, type Component } from '../../src/shared/signing/documents'
import { keyFromEnv, signEnvelope } from '../keys/key-list'

/** What `component.json` says about a release besides what packing measures, and where it is written. */
type ReleaseOptions = Pick<
  Component,
  'id' | 'kind' | 'version' | 'channel' | 'requires' | 'provides' | 'releaseNotes'
> & {
  /** Where `component.json` and `component.json.sig` (and the zip) are written. */
  out: string
}

/** A directory to pack as a zip. */
export type PackOptions = ReleaseOptions & {
  /** The directory whose files the zip holds, at its root. */
  dir: string
}

/** One file to describe as it is. */
type FileOptions = ReleaseOptions & {
  /** The artifact itself, such as the hub installer. */
  file: string
}

/** Writes the signed `component.json` pinning `artifact` into `out`; returns it. */
function describeArtifact(
  { out, ...release }: ReleaseOptions,
  artifact: string,
  maxUncompressedSize: number,
  privateKey: KeyObject
): Component {
  const bytes = readFileSync(artifact)
  const component = componentSchema.parse({
    ...release,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    maxUncompressedSize
  })
  mkdirSync(out, { recursive: true })
  writeFileSync(join(out, 'component.json'), `${JSON.stringify(component, null, 2)}\n`)
  writeFileSync(
    join(out, 'component.json.sig'),
    `${JSON.stringify(signEnvelope(component, privateKey), null, 2)}\n`
  )
  return component
}

/** Zips `options.dir` and writes the signed `component.json` beside the zip. */
export async function packComponent(
  { dir, ...release }: PackOptions,
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
  mkdirSync(release.out, { recursive: true })
  const zip = join(release.out, `${release.id}-${release.version}.zip`)
  await pipeline(zipfile.outputStream, createWriteStream(zip))
  return { zip, component: describeArtifact(release, zip, uncompressed, privateKey) }
}

/** Writes the signed `component.json` of `options.file` as it is: nothing to extract, so the cap is its size. */
export function packFile({ file, ...release }: FileOptions, privateKey: KeyObject): Component {
  return describeArtifact(release, file, statSync(file).size, privateKey)
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      file: { type: 'string' },
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
  const release: ReleaseOptions = {
    out: values.out ?? '',
    id: values.id ?? '',
    kind: values.kind ?? '',
    version: values.version ?? '',
    channel: values.channel as Component['channel'],
    releaseNotes: values['release-notes'] ?? '',
    requires: JSON.parse(values.requires) as Component['requires'],
    provides: JSON.parse(values.provides) as Component['provides']
  }
  const key = keyFromEnv('STYLISTIC_COMPONENT_KEY')
  const { artifact, component } = values.file
    ? { artifact: values.file, component: packFile({ ...release, file: values.file }, key) }
    : await packComponent({ ...release, dir: values.dir ?? '' }, key).then(({ zip, component }) => ({
        artifact: zip,
        component
      }))
  console.log(`${artifact}: ${component.size} bytes, sha256 ${component.sha256}`)
}
