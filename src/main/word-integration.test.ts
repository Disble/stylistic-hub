import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import 'reflect-metadata'
import { webcrypto, X509Certificate } from 'node:crypto'
import * as x509 from '@peculiar/x509'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWordIntegration, execute, type RunCommand } from './word-integration'

/** The add-in's manifest id. */
const addinId = 'b821964a-4f1e-4939-83c8-0ddba48f3dff'
/** Office's sideload list for the current user. */
const developerKey = 'HKCU\\SOFTWARE\\Microsoft\\Office\\16.0\\Wef\\Developer'

/** Folder with the CA and the built add-in. */
let dir: string
/** Where the CA certificate is. */
let caFile: string
/** Where the manifest is. */
let manifestFile: string
/** Windows thumbprint of the CA. */
let thumbprint: string

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hub-word-'))
  const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])) as webcrypto.CryptoKeyPair
  const caCert = (
    await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=Test CA',
      notBefore: new Date('2026-10-01T00:00:00Z'),
      notAfter: new Date('2036-10-01T00:00:00Z'),
      keys,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' }
    })
  ).toString('pem')
  caFile = join(dir, 'ca.pem')
  writeFileSync(caFile, caCert)
  thumbprint = new X509Certificate(caCert).fingerprint.replaceAll(':', '')
  manifestFile = join(dir, 'manifest.xml')
  writeFileSync(manifestFile, `<OfficeApp><Id>${addinId}</Id><Version>1.0.0.0</Version></OfficeApp>`)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A command runner that answers each command with the given exit code and output. */
function commands(answers: Record<string, { code: number; stdout?: string }>) {
  return vi.fn<RunCommand>(async (command, args) => {
    const answer = answers[`${command} ${args[0]}`] ?? answers[command] ?? { code: 0 }
    return { code: answer.code, stdout: answer.stdout ?? '' }
  })
}

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0])

describe('createWordIntegration', () => {
  it('reports a trusted CA and a registered add-in', async () => {
    const run = commands({
      certutil: { code: 0 },
      'reg query': {
        code: 0,
        stdout: `\r\n${developerKey}\r\n    ${addinId}    REG_SZ    ${manifestFile}\r\n`
      }
    })
    const word = createWordIntegration({ run, caFile, manifestFile })

    expect(await word.status()).toEqual({
      available: true,
      caTrusted: true,
      addinRegistered: true,
      version: '1.0.0.0'
    })
    expect(run).toHaveBeenCalledWith('certutil', ['-user', '-store', 'Root', thumbprint])
    expect(run).toHaveBeenCalledWith('reg', ['query', developerKey, '/v', addinId])
  })

  it('reports what is missing', async () => {
    const run = commands({ certutil: { code: 1 }, 'reg query': { code: 1 } })

    expect(await createWordIntegration({ run, caFile, manifestFile }).status()).toEqual({
      available: true,
      caTrusted: false,
      addinRegistered: false,
      version: '1.0.0.0'
    })
  })

  it('treats a registration that points at another manifest as missing', async () => {
    const run = commands({
      'reg query': { code: 0, stdout: `    ${addinId}    REG_SZ    C:\\old\\manifest.xml\r\n` }
    })

    expect((await createWordIntegration({ run, caFile, manifestFile }).status()).addinRegistered).toBe(false)
  })

  it('is unavailable until the add-in is bundled and the CA exists', async () => {
    const run = commands({})

    const word = createWordIntegration({ run, caFile, manifestFile: join(dir, 'missing.xml') })

    expect(await word.status()).toEqual({ available: false, caTrusted: false, addinRegistered: false })
    await expect(word.connect()).rejects.toThrow(/not bundled/)
    expect(run).not.toHaveBeenCalled()
  })

  it('connects by trusting the CA for this user and registering the manifest with Office', async () => {
    const run = commands({ certutil: { code: 1 } })
    const trusting = vi.fn<RunCommand>(async (command, args) =>
      command === 'certutil' && args[1] === '-store' ? { code: 1, stdout: '' } : { code: 0, stdout: '' }
    )

    await createWordIntegration({ run: trusting, caFile, manifestFile }).connect()

    expect(trusting).toHaveBeenCalledWith('certutil', ['-user', '-addstore', 'Root', caFile])
    expect(trusting).toHaveBeenCalledWith('reg', [
      'add',
      developerKey,
      '/v',
      addinId,
      '/t',
      'REG_SZ',
      '/d',
      manifestFile,
      '/f'
    ])
    expect(run).not.toHaveBeenCalled()
  })

  it('drops older registrations of this manifest under another add-in id and leaves the rest alone', async () => {
    const run = commands({
      'reg query': {
        code: 0,
        stdout: [
          developerKey.replace('HKCU', 'HKEY_CURRENT_USER'),
          `    old-dev-id    REG_SZ    ${manifestFile}`,
          `    ${addinId}    REG_SZ    ${manifestFile}`,
          '    someone-else    REG_SZ    D:\\other\\manifest.xml',
          ''
        ].join('\r\n')
      }
    })

    await createWordIntegration({ run, caFile, manifestFile }).connect()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', 'old-dev-id', '/f'])
    expect(run).not.toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
    expect(run).not.toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', 'someone-else', '/f'])
  })

  it('does not ask Windows to trust a CA it already trusts', async () => {
    const run = commands({ 'certutil -user': { code: 0 } })

    await createWordIntegration({ run, caFile, manifestFile }).connect()

    expect(run).not.toHaveBeenCalledWith('certutil', expect.arrayContaining(['-addstore']))
  })

  it('stops when the user declines the Windows trust prompt', async () => {
    const run = vi.fn<RunCommand>(async () => ({ code: 1, stdout: '' }))

    await expect(createWordIntegration({ run, caFile, manifestFile }).connect()).rejects.toThrow(
      /Windows did not trust/
    )
    expect(run).not.toHaveBeenCalledWith('reg', expect.anything())
  })

  it('disconnects by removing the registration', async () => {
    const run = commands({})

    await createWordIntegration({ run, caFile, manifestFile }).disconnect()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
  })

  it('fails when Office refuses the registration', async () => {
    const run = commands({ 'reg add': { code: 5 } })

    await expect(createWordIntegration({ run, caFile, manifestFile }).connect()).rejects.toThrow(
      /Could not add Stylistic to Word/
    )
  })

  it('refuses a manifest without an add-in id instead of registering an empty name', async () => {
    writeFileSync(manifestFile, '<OfficeApp></OfficeApp>')
    const run = commands({})

    await expect(createWordIntegration({ run, caFile, manifestFile }).connect()).rejects.toThrow(/no <Id>/)
    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['add']))
  })
})

describe('execute', () => {
  it('reports the exit code and output of a command without throwing', async () => {
    const ok = await execute(process.execPath, ['-e', 'process.stdout.write("hi")'])
    const failed = await execute(process.execPath, ['-e', 'process.exit(3)'])
    const missing = await execute('stylistic-hub-no-such-command', [])

    expect(ok).toEqual({ code: 0, stdout: 'hi' })
    expect(failed.code).toBe(3)
    expect(missing.code).toBe(1)
  })

  it('reports a removal that did not happen', async () => {
    const run = commands({ 'reg query': { code: 0, stdout: `    ${addinId}    REG_SZ    ${manifestFile}` } })

    await expect(createWordIntegration({ run, caFile, manifestFile }).disconnect()).rejects.toThrow(
      /Could not remove/
    )
  })
})
