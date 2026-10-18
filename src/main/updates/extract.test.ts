import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractZip } from './extract'
import { makeZip, patchName, type ZipItem } from './zip-fixtures'

/** The scratch directory of the current test. */
let scratch: string
/** Where the zip is extracted. */
let dest: string

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'stylistic-extract-'))
  dest = join(scratch, 'out')
})

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true })
})

/** Writes `zip` to the scratch directory and extracts it with a cap of `max` bytes. */
async function extract(zip: Buffer, max = 1_000_000): Promise<string> {
  const file = join(scratch, 'in.zip')
  await writeFile(file, zip)
  return extractZip(file, dest, max)
}

/** A zip holding a harmless file first and then `item`. */
function withEntry(item: ZipItem): Promise<Buffer> {
  return makeZip([{ name: 'ok.txt', data: 'fine' }, item])
}

describe('extractZip', () => {
  it('extracts files and folders, keeping names that only start like a reserved one', async () => {
    const zip = await makeZip([
      { name: 'entry.js', data: 'main' },
      { name: 'lib/', data: '' },
      { name: 'lib/deep/console.txt', data: 'nested' }
    ])

    expect(await extract(zip, 10)).toBe('ok')
    expect(await readFile(join(dest, 'entry.js'), 'utf8')).toBe('main')
    expect(await readFile(join(dest, 'lib', 'deep', 'console.txt'), 'utf8')).toBe('nested')
  })

  it.each([
    ['an absolute path', 'xevil.txt', '/evil.txt'],
    ['a drive letter', 'Cxevil.txt', 'C:evil.txt'],
    ['a .. segment', 'xx/evil.txt', '../evil.txt'],
    ['a backslash', 'axxxxevil.txt', 'a\\..\\evil.txt']
  ])('rejects %s and leaves nothing behind', async (_case, placeholder, malicious) => {
    const zip = patchName(await withEntry({ name: placeholder, data: 'pwned' }), placeholder, malicious)

    expect(await extract(zip)).toBe('bad_zip')
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(join(scratch, 'evil.txt'))).toBe(false)
  })

  it('rejects a symlink entry', async () => {
    const zip = await withEntry({ name: 'link', data: '../../outside', mode: 0o120777 })

    expect(await extract(zip)).toBe('symlink')
    expect(existsSync(dest)).toBe(false)
  })

  it.each(['CON', 'sub/nul.txt', 'Com1.log', 'lpt9', 'aux/file.js', 'PRN.tar.gz'])(
    'rejects the reserved name %s',
    async (name) => {
      expect(await extract(await withEntry({ name, data: 'x' }))).toBe('reserved_name')
      expect(existsSync(dest)).toBe(false)
    }
  )

  it('stops once the uncompressed total passes the signed cap', async () => {
    const zip = await makeZip([
      { name: 'a.txt', data: '12345' },
      { name: 'b.txt', data: '67890' }
    ])

    expect(await extract(zip, 9)).toBe('too_large')
    expect(existsSync(dest)).toBe(false)
  })

  it('rejects a file that is not a zip', async () => {
    expect(await extract(Buffer.from('not a zip at all'))).toBe('bad_zip')
    expect(existsSync(dest)).toBe(false)
  })
})
