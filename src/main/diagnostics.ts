// The diagnostics bundle a user exports from the Server screen and attaches to a report (odd/tasks/readiness.md
// S2): `summary.json` and the files of the hub's logs folder. It reads nothing else, so Pi's credentials, the hub
// token, the CA private key and the environment never reach it.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ZipFile } from 'yazl'
import type { ServerStatus, WordStatus } from '../shared/bridge'
import { readState } from './updates/state'

/** Where the bundle's contents come from; injected so it is built without Electron. */
export interface DiagnosticsSources {
  logsDir: string
  /** The update engine's directory, holding `state.json`. */
  componentsRoot: string
  hubVersion: string
  os: string
  versions: { electron: string; node: string }
  serverStatus: () => ServerStatus
  wordStatus: () => Promise<WordStatus>
}

/** The value, or why it could not be read: a report is most needed when something is broken. */
async function orError<T>(read: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await read()
  } catch (error) {
    return { error: String(error) }
  }
}

/** The names of the regular files directly in `dir`; none when it does not exist yet. */
async function topLevelFiles(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name)
  } catch {
    return []
  }
}

/** Builds the zip: `summary.json` and `logs/<file>` for each file of the logs folder, as written. */
export async function buildDiagnostics(sources: DiagnosticsSources): Promise<Buffer> {
  const summary = {
    hubVersion: sources.hubVersion,
    os: sources.os,
    electron: sources.versions.electron,
    node: sources.versions.node,
    server: sources.serverStatus(),
    word: await orError(sources.wordStatus),
    components: await orError(() => readState(sources.componentsRoot))
  }
  const zipfile = new ZipFile()
  zipfile.addBuffer(Buffer.from(JSON.stringify(summary, null, 2)), 'summary.json')
  for (const name of await topLevelFiles(sources.logsDir)) {
    zipfile.addBuffer(await readFile(join(sources.logsDir, name)), `logs/${name}`)
  }
  zipfile.end()
  const chunks: Buffer[] = []
  for await (const chunk of zipfile.outputStream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** Asks where to save the bundle and writes it there; returns the path, or undefined when the user cancels. */
export async function exportDiagnostics(
  options: DiagnosticsSources & { choosePath: () => Promise<string | undefined> }
): Promise<string | undefined> {
  const target = await options.choosePath()
  if (!target) return undefined
  await writeFile(target, await buildDiagnostics(options))
  return target
}
