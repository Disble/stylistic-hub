// Strict zip extraction with yauzl (odd/tasks/update-engine.md S2). yauzl itself rejects absolute paths,
// drive letters, `..` segments and backslashes in entry names; this adds symlinks, Windows reserved names and
// the uncompressed size cap declared in the signed component.json. A rejected zip leaves no directory behind.
import { createWriteStream } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

/** Why a zip is not extracted. */
export type ExtractRejection = 'bad_zip' | 'symlink' | 'reserved_name' | 'too_large'

/** CON, PRN, AUX, NUL, COM1–9 and LPT1–9, case-insensitive, with or without an extension. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Whether a path segment names a reserved device or aliases another name on Windows: Windows strips trailing
 * spaces and dots (`aux ` is AUX, `entry.js.` is `entry.js`) and reads `:` as an alternate data stream.
 * Rejecting any segment that ends in a space or a dot covers the reserved names written with that suffix too.
 */
function isWindowsAlias(segment: string): boolean {
  return /[ .]$/.test(segment) || segment.includes(':') || RESERVED.test(segment)
}

/** The Unix file type bits of a zip entry's external attributes, and the symlink type. */
const S_IFMT = 0o170000
/** The Unix symlink file type. */
const S_IFLNK = 0o120000

/** A rejection raised while walking the entries. */
class Rejected extends Error {
  constructor(readonly reason: ExtractRejection) {
    super(reason)
  }
}

/** Why `entry` may not be extracted, or undefined when it may. */
function entryRejection(entry: Entry): ExtractRejection | undefined {
  if (((entry.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK) return 'symlink'
  if (entry.fileName.split('/').some(isWindowsAlias)) return 'reserved_name'
  return undefined
}

/** Opens a zip with lazy entries and size validation. */
function openZip(zip: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zip, { lazyEntries: true, validateEntrySizes: true }, (error, zipfile) =>
      error ? reject(error) : resolve(zipfile)
    )
  })
}

/** Writes one file entry to `target`. */
async function writeEntry(zipfile: ZipFile, entry: Entry, target: string): Promise<void> {
  const stream = await promisify(zipfile.openReadStream.bind(zipfile))(entry)
  await pipeline(stream, createWriteStream(target))
}

/** Walks every entry, extracting each into `dest` after checking it, until the end or the first rejection. */
function extractEntries(zipfile: ZipFile, dest: string, maxUncompressedSize: number): Promise<void> {
  let total = 0
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      zipfile.close()
      reject(error)
    }
    zipfile.on('error', fail)
    zipfile.on('end', () => resolve())
    zipfile.on('entry', (entry: Entry) => {
      const rejection = entryRejection(entry)
      if (rejection) return fail(new Rejected(rejection))
      total += entry.uncompressedSize
      if (total > maxUncompressedSize) return fail(new Rejected('too_large'))
      const target = join(dest, entry.fileName)
      const write = entry.fileName.endsWith('/')
        ? mkdir(target, { recursive: true })
        : mkdir(dirname(target), { recursive: true }).then(() => writeEntry(zipfile, entry, target))
      write.then(() => zipfile.readEntry(), fail)
    })
    zipfile.readEntry()
  })
}

/** Extracts `zip` into `dest`; on any rejection `dest` is removed and the reason returned. */
export async function extractZip(
  zip: string,
  dest: string,
  maxUncompressedSize: number
): Promise<'ok' | ExtractRejection> {
  try {
    await mkdir(dest, { recursive: true })
    await extractEntries(await openZip(zip), dest, maxUncompressedSize)
    return 'ok'
  } catch (error) {
    await rm(dest, { recursive: true, force: true })
    return error instanceof Rejected ? error.reason : 'bad_zip'
  }
}
