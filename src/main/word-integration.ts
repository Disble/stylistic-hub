import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { copyFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { WordStatus } from '../shared/bridge'

/** Runs a Windows command and reports its exit code and output; it never throws on failure. */
export type RunCommand = (command: string, args: string[]) => Promise<{ code: number; stdout: string }>

/** Office's list of sideloaded add-ins for the current user: add-in id → manifest path. */
const DEVELOPER_KEY = 'HKCU\\SOFTWARE\\Microsoft\\Office\\16.0\\Wef\\Developer'

/** What the integration works on. */
export interface WordIntegrationOptions {
  run?: RunCommand
  /** The local CA the backend wrote (`certs/ca.pem`). */
  caFile: string
  /** The bundled add-in's manifest, which points Word at `https://localhost:3000`. */
  manifestFile: string
}

/** Runs a command with `execFile`, so no shell parses the paths. */
export const execute: RunCommand = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) =>
      resolve({ code: error ? Number(error.code ?? 1) || 1 : 0, stdout })
    )
  })

/**
 * Adds Stylistic to Word for this Windows user: trusts the hub's CA in the user's Root store
 * (Windows asks the user to confirm) and sideloads the manifest the way Office's own dev tools do.
 * Custom code: office-addin-dev-settings writes the same registry value but brings Teams publishing,
 * prompts and usage telemetry along, so the hub calls Windows' `certutil` and `reg` directly.
 */
export function createWordIntegration({ run = execute, caFile, manifestFile }: WordIntegrationOptions) {
  const available = () => existsSync(caFile) && existsSync(manifestFile)
  const thumbprint = () => new X509Certificate(readFileSync(caFile)).fingerprint.replaceAll(':', '')
  const manifestValue = (tag: string) =>
    new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(readFileSync(manifestFile, 'utf8'))?.[1]
  const addinId = () => {
    const id = manifestValue('Id')
    if (!id) throw new Error(`The add-in manifest has no <Id>: ${manifestFile}`)
    return id
  }

  const caTrusted = async () => (await run('certutil', ['-user', '-store', 'Root', thumbprint()])).code === 0
  const addinRegistered = async () => {
    const { code, stdout } = await run('reg', ['query', DEVELOPER_KEY, '/v', addinId()])
    return code === 0 && stdout.includes(manifestFile)
  }

  return {
    async status(): Promise<WordStatus> {
      if (!available()) return { available: false, caTrusted: false, addinRegistered: false }
      const version = manifestValue('Version')
      return {
        available: true,
        caTrusted: await caTrusted(),
        addinRegistered: await addinRegistered(),
        ...(version ? { version } : {})
      }
    },

    async connect(): Promise<void> {
      if (!available())
        throw new Error('The Word add-in is not bundled with this hub, or the server has not started yet')
      if (
        !(await caTrusted()) &&
        (await run('certutil', ['-user', '-addstore', 'Root', caFile])).code !== 0
      ) {
        throw new Error('Windows did not trust the hub certificate, so Word cannot open Stylistic')
      }
      const added = await run('reg', [
        'add',
        DEVELOPER_KEY,
        '/v',
        addinId(),
        '/t',
        'REG_SZ',
        '/d',
        manifestFile,
        '/f'
      ])
      if (added.code !== 0) throw new Error('Could not add Stylistic to Word')
    },

    async disconnect(): Promise<void> {
      await run('reg', ['delete', DEVELOPER_KEY, '/v', addinId(), '/f'])
      // `reg delete` also fails when the value is already gone, so check the outcome instead.
      if (await addinRegistered()) throw new Error('Could not remove Stylistic from Word')
    }
  }
}

/** What opening Word works on. */
export interface OpenWordOptions {
  /** The bundled document whose web extension part points at the sideloaded add-in. */
  documentFile: string
  /** Where the copy goes, so the user never edits the installed file. */
  workDir: string
  /** Opens a file with its default app and returns an error message, or '' on success (Electron's `shell.openPath`). */
  openFile: (path: string) => Promise<string>
}

/**
 * Opens Word on a document that loads Stylistic. Registering the manifest only makes Word able to find the
 * add-in; Office's own dev tools (office-addin-dev-settings `sideloadAddIn`) also open such a document,
 * and that is what makes Word load it.
 */
export async function openWordDocument({ documentFile, workDir, openFile }: OpenWordOptions): Promise<void> {
  if (!existsSync(documentFile))
    throw new Error('The Word document for Stylistic is not bundled with this hub')
  const copy = join(workDir, basename(documentFile))
  // Word locks a document it has open; then the copy from last time opens again.
  await copyFile(documentFile, copy).catch(() => undefined)
  const failure = await openFile(copy)
  if (failure) throw new Error(`Could not open Word: ${failure}`)
}
