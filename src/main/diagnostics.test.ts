import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerStatus, WordStatus } from '../shared/bridge'
import { buildDiagnostics, exportDiagnostics, type DiagnosticsSources } from './diagnostics'
import { hubPaths } from './hub-paths'
import { loadOrCreateHubToken } from './hub-token'

/** The server as the Server screen shows it. */
const SERVER: ServerStatus = {
  state: 'running',
  version: '1.2.0',
  address: 'https://localhost:3000',
  crashes: 1,
  lastExitCode: 9
}
/** Word as the Word screen shows it. */
const WORD: WordStatus = { available: true, caTrusted: true, addinRegistered: false, version: '1.0.0.0' }
/** A components `state.json` with one installed server and its history. */
const STATE = {
  serial: 4,
  keysVersion: 2,
  components: { server: { current: '1.2.0', previous: '1.1.0', bad: [], keyId: 'k1' } },
  history: [
    {
      time: '2026-10-18T10:00:00.000Z',
      component: 'server',
      from: '1.1.0',
      to: '1.2.0',
      outcome: 'installed',
      reason: null
    }
  ]
}

/** A fake `userData`, laid out where the hub keeps each file. */
let userData: string
/** The bundle's sources over that `userData`. */
let sources: DiagnosticsSources

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'hub-diagnostics-'))
  const logsDir = join(userData, 'logs')
  mkdirSync(logsDir)
  writeFileSync(join(logsDir, 'server.log'), 'backend 1.2.0 listening\n')
  writeFileSync(join(logsDir, 'word-session.log'), 'loaded in attempt 1\n')
  mkdirSync(join(userData, 'components'))
  writeFileSync(join(userData, 'components', 'state.json'), JSON.stringify(STATE))
  sources = {
    logsDir,
    componentsRoot: join(userData, 'components'),
    hubVersion: '0.4.0',
    os: 'Windows_NT 10.0.26300 x64',
    versions: { electron: '44.7.2', node: '24.21.0' },
    serverStatus: () => SERVER,
    wordStatus: async () => WORD
  }
})

afterEach(() => rmSync(userData, { recursive: true, force: true }))

/** The bundle's entries by name. */
function entries(zip: Buffer): Map<string, Buffer> {
  return new Map(new AdmZip(zip).getEntries().map((e) => [e.entryName, e.getData()]))
}

describe('buildDiagnostics', () => {
  it('holds summary.json and the files of the logs folder, nothing else', async () => {
    mkdirSync(join(sources.logsDir, 'nested'))
    writeFileSync(join(sources.logsDir, 'nested', 'other.log'), 'not a top-level file')

    const files = entries(await buildDiagnostics(sources))

    expect([...files.keys()].sort()).toEqual(['logs/server.log', 'logs/word-session.log', 'summary.json'])
    expect(files.get('logs/server.log')?.toString()).toBe('backend 1.2.0 listening\n')
    expect(files.get('logs/word-session.log')?.toString()).toBe('loaded in attempt 1\n')
  })

  it('summarizes versions, the server and Word as the hub shows them, and the components state', async () => {
    const summary = JSON.parse(
      entries(await buildDiagnostics(sources))
        .get('summary.json')!
        .toString()
    )

    expect(summary).toEqual({
      hubVersion: '0.4.0',
      os: 'Windows_NT 10.0.26300 x64',
      electron: '44.7.2',
      node: '24.21.0',
      server: SERVER,
      word: WORD,
      components: STATE
    })
  })

  it('records why Word status or the components state could not be read, instead of failing', async () => {
    writeFileSync(join(sources.componentsRoot, 'state.json'), '{ not json')
    sources.wordStatus = async () => {
      throw new Error('certutil failed')
    }

    const summary = JSON.parse(
      entries(await buildDiagnostics(sources))
        .get('summary.json')!
        .toString()
    )

    expect(summary.word).toEqual({ error: 'Error: certutil failed' })
    expect(summary.components.error).toBeTypeOf('string')
  })

  it('bundles an empty logs list when the logs folder does not exist yet', async () => {
    rmSync(sources.logsDir, { recursive: true })

    expect([...entries(await buildDiagnostics(sources)).keys()]).toEqual(['summary.json'])
  })

  it('never carries the hub token, Pi credentials, the CA private key or environment variables', async () => {
    const paths = hubPaths(userData)
    const token = loadOrCreateHubToken(paths.token)
    const piSecret = 'pi-secret-refresh-token-0123456789'
    const caKeySecret = 'ca-private-key-material-0123456789'
    const envSecret = 'env-secret-value-0123456789'
    mkdirSync(paths.piDir)
    writeFileSync(join(paths.piDir, 'auth.json'), JSON.stringify({ anthropic: { refresh: piSecret } }))
    mkdirSync(paths.certificates)
    writeFileSync(join(paths.certificates, 'ca-key.pem'), caKeySecret)
    process.env['STYLISTIC_DIAGNOSTICS_TEST_SECRET'] = envSecret
    try {
      const zip = await buildDiagnostics(sources)

      for (const secret of [token, piSecret, caKeySecret, envSecret]) {
        expect(zip.includes(secret)).toBe(false)
        for (const [name, data] of entries(zip))
          expect(data.includes(secret), `${secret} in ${name}`).toBe(false)
      }
    } finally {
      delete process.env['STYLISTIC_DIAGNOSTICS_TEST_SECRET']
    }
  })
})

describe('exportDiagnostics', () => {
  it('writes the bundle where the user chose and returns that path', async () => {
    const target = join(userData, 'out', 'diagnostics.zip')
    mkdirSync(join(userData, 'out'))

    const saved = await exportDiagnostics({ ...sources, choosePath: async () => target })

    expect(saved).toBe(target)
    expect(new AdmZip(target).getEntries().map((e) => e.entryName)).toContain('summary.json')
  })

  it('writes nothing when the user cancels the save dialog', async () => {
    mkdirSync(join(userData, 'out'))
    let read = false
    const saved = await exportDiagnostics({
      ...sources,
      serverStatus: () => ((read = true), SERVER),
      choosePath: async () => undefined
    })

    expect(saved).toBeUndefined()
    expect(readdirSync(join(userData, 'out'))).toEqual([])
    expect(read).toBe(false)
  })
})
