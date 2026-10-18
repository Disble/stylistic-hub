// Resumable download of a component's zip into its staging directory (odd/tasks/update-engine.md S2).
import { existsSync, statSync, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'

/** The size of `file`, or 0 when it does not exist. */
export function fileSize(file: string): number {
  return existsSync(file) ? statSync(file).size : 0
}

/**
 * Downloads `url` into `file`. A partial `file` of N bytes is resumed with `Range: bytes=N-`: a 206 appends,
 * a 200 starts over. Returns false on a network failure or any other status; what arrived stays for a resume.
 */
export async function downloadResumable(fetcher: typeof fetch, url: string, file: string): Promise<boolean> {
  const have = fileSize(file)
  try {
    const response = await fetcher(url, have > 0 ? { headers: { Range: `bytes=${have}-` } } : {})
    if (response.status !== 200 && response.status !== 206) return false
    const flags = response.status === 206 ? 'a' : 'w'
    await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(file, { flags }))
    return true
  } catch {
    return false
  }
}
