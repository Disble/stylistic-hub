import { execFile } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, sep } from 'node:path'
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
  /**
   * The stable manifests (`components/<id>/manifest.xml`) of the installed modules served now
   * (odd/tasks/module-library.md S4): Word gets these instead of the bundled manifest. None: the bundled add-in.
   */
  moduleManifests?: () => string[]
  /** The components directory: a registration of a manifest under it that is no longer served is removed. */
  componentsRoot?: string
}

/** One value of Office's sideload list. */
interface Listed {
  name: string
  path: string
}

/** Runs a command with `execFile`, so no shell parses the paths. */
export const execute: RunCommand = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { windowsHide: true }, (error, stdout) =>
      resolve({ code: error ? Number(error.code ?? 1) || 1 : 0, stdout })
    )
  })

/** The sha256 of a manifest's content. */
function hashOf(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Where the hash of a module manifest's last registration is kept: beside its component folder
 * (`components/<id>.registered.sha256`), because an install deletes everything else inside that folder.
 */
function hashFileOf(manifest: string): string {
  return `${dirname(manifest)}.registered.sha256`
}

/** Whether module manifest `file` changed since it was last registered. */
function changedSinceRegistered(file: string): boolean {
  const hashFile = hashFileOf(file)
  return !existsSync(hashFile) || readFileSync(hashFile, 'utf8') !== hashOf(file)
}

/**
 * Adds Stylistic to Word for this Windows user: trusts the hub's CA in the user's Root store
 * (Windows asks the user to confirm) and sideloads the manifest the way Office's own dev tools do.
 * Custom code: office-addin-dev-settings writes the same registry value but brings Teams publishing,
 * prompts and usage telemetry along, so the hub calls Windows' `certutil` and `reg` directly.
 * With modules installed, their stable manifests replace the bundled one, registered again only when their
 * content hash changes; the bundled root-URL entry is then removed (ADR 0001 D8, cutover step two).
 */
export function createWordIntegration({
  run = execute,
  caFile,
  manifestFile,
  moduleManifests = () => [],
  componentsRoot
}: WordIntegrationOptions) {
  /** What Word should load: the served module manifests, else the bundled one when it exists. */
  const targets = () => {
    const served = moduleManifests().filter((file) => existsSync(file))
    return served.length > 0 || !existsSync(manifestFile) ? served : [manifestFile]
  }
  /** Every manifest Stylistic may be registered with now: the targets, then the bundled one. */
  const known = () => [...new Set([...targets(), ...(existsSync(manifestFile) ? [manifestFile] : [])])]
  const available = () => existsSync(caFile) && targets().length > 0
  const thumbprint = () => new X509Certificate(readFileSync(caFile)).fingerprint.replaceAll(':', '')
  const manifestValue = (file: string, tag: string) =>
    new RegExp(`<${tag}>([^<]+)</${tag}>`).exec(readFileSync(file, 'utf8'))?.[1]
  const addinId = (file: string) => {
    const id = manifestValue(file, 'Id')
    if (!id) throw new Error(`The add-in manifest has no <Id>: ${file}`)
    return id
  }
  /** Whether a registered path is Stylistic's: the bundled manifest or a module manifest. */
  const ours = (path: string) =>
    path === manifestFile || (componentsRoot !== undefined && path.startsWith(componentsRoot + sep))

  const caTrusted = async () => (await run('certutil', ['-user', '-store', 'Root', thumbprint()])).code === 0
  const registered = async (file: string) => {
    const { code, stdout } = await run('reg', ['query', DEVELOPER_KEY, '/v', addinId(file)])
    return code === 0 && stdout.includes(file)
  }
  const addinRegistered = async () => {
    for (const file of known()) if (await registered(file)) return true
    return false
  }
  const remove = (name: string) => run('reg', ['delete', DEVELOPER_KEY, '/v', name, '/f'])
  /** The values of Office's sideload list. */
  const listed = async (): Promise<Listed[]> => {
    const { stdout } = await run('reg', ['query', DEVELOPER_KEY])
    return [...stdout.matchAll(/^\s+(\S+)\s+REG_SZ\s+(.+?)\s*$/gm)].map(([, name = '', path = '']) => ({
      name,
      path
    }))
  }

  /** Registers `file` under its add-in id; a module manifest's hash is kept for the next `sync`. */
  const register = async (file: string, values: Listed[]) => {
    // An earlier hub, or an earlier version of the manifest, may have listed it under another add-in id; Word
    // would then see one manifest twice.
    for (const { name, path } of values) if (path === file && name !== addinId(file)) await remove(name)
    const added = await run('reg', [
      'add',
      DEVELOPER_KEY,
      '/v',
      addinId(file),
      '/t',
      'REG_SZ',
      '/d',
      file,
      '/f'
    ])
    if (added.code !== 0) throw new Error('Could not add Stylistic to Word')
    if (file !== manifestFile) writeFileSync(hashFileOf(file), hashOf(file))
  }

  /** Whether `file` must be registered: it is not listed, or it is a module manifest whose content changed. */
  const stale = (file: string, values: Listed[]) =>
    !values.some(({ path }) => path === file) || (file !== manifestFile && changedSinceRegistered(file))

  /** Registers the targets (every one, or only the stale ones), then removes Stylistic's entries no target names. */
  const registerTargets = async (every: boolean) => {
    const wanted = targets()
    const values = await listed()
    for (const file of wanted) if (every || stale(file, values)) await register(file, values)
    // Listed again: a module manifest under the bundled add-in's id has just replaced that entry.
    for (const { name, path } of await listed()) if (ours(path) && !wanted.includes(path)) await remove(name)
  }

  return {
    async status(): Promise<WordStatus> {
      if (!available()) return { available: false, caTrusted: false, addinRegistered: false }
      const version = manifestValue(targets()[0] ?? manifestFile, 'Version')
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
      await registerTargets(true)
    },

    /**
     * After the served modules changed (module-switch.ts): while Stylistic is in Word, registers each module
     * manifest whose content hash changed, or the bundled one when no module is served, and removes the entries
     * nothing serves any more, the bundled root-URL entry included. Adds nothing while Stylistic is not in Word.
     */
    async sync(): Promise<void> {
      if (!available() || !(await listed()).some(({ path }) => ours(path))) return
      await registerTargets(false)
    },

    async disconnect(): Promise<void> {
      for (const file of known()) await remove(addinId(file))
      // `reg delete` also fails when the value is already gone, so check the outcome instead.
      if (await addinRegistered()) throw new Error('Could not remove Stylistic from Word')
    }
  }
}
