import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import 'reflect-metadata'
import { createHash, webcrypto, X509Certificate } from 'node:crypto'
import * as x509 from '@peculiar/x509'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWordIntegration, execute, type RunCommand } from './word-integration'
import { WORD_MODULE_ID } from '../shared/bridge'

/** The Word module id the signed catalog actually offers: the request id cannot hide behind a literal. */
function catalogWordId(): string {
  const source = JSON.parse(readFileSync('catalog/catalog.source.json', 'utf8')) as {
    components: { id: string; kind: string }[]
  }
  const id = source.components.find((component) => component.kind === 'office-addin')?.id
  if (!id) throw new Error('The catalog offers no office-addin module')
  return id
}

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
    const word = createWordIntegration({ run, caFile, manifestFile, moduleManifests: () => [manifestFile] })

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

    expect(
      await createWordIntegration({
        run,
        caFile,
        manifestFile,
        moduleManifests: () => [manifestFile]
      }).status()
    ).toEqual({
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

    expect(
      (
        await createWordIntegration({
          run,
          caFile,
          manifestFile,
          moduleManifests: () => [manifestFile]
        }).status()
      ).addinRegistered
    ).toBe(false)
  })

  it('is unavailable until a downloaded module is served and the CA exists', async () => {
    const run = commands({})

    const word = createWordIntegration({ run, caFile, manifestFile: join(dir, 'missing.xml') })

    expect(await word.status()).toEqual({ available: false, caTrusted: false, addinRegistered: false })
    await expect(word.connect()).rejects.toThrow(
      `not downloaded yet. Install "${WORD_MODULE_ID}" from the Library`
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('says the server has not started yet when a module is served but the CA is missing', async () => {
    const run = commands({})
    const missingCa = join(dir, 'missing-ca.pem')

    await expect(
      createWordIntegration({
        run,
        caFile: missingCa,
        manifestFile,
        moduleManifests: () => [manifestFile]
      }).connect()
    ).rejects.toThrow(/server has not started yet/)
    expect(run).not.toHaveBeenCalled()
  })

  it('names the Word module under its real catalog id', () => {
    expect(WORD_MODULE_ID).toBe(catalogWordId())
  })

  it(`tells a hub without a downloaded module to install ${WORD_MODULE_ID} from the Library`, async () => {
    const run = commands({})

    await expect(createWordIntegration({ run, caFile, manifestFile }).connect()).rejects.toThrow(
      `Install "${WORD_MODULE_ID}" from the Library`
    )
    expect(run).not.toHaveBeenCalled()
  })
  it('connects by trusting the CA for this user and registering the manifest with Office', async () => {
    const run = commands({ certutil: { code: 1 } })
    const trusting = vi.fn<RunCommand>(async (command, args) =>
      command === 'certutil' && args[1] === '-store' ? { code: 1, stdout: '' } : { code: 0, stdout: '' }
    )

    await createWordIntegration({
      run: trusting,
      caFile,
      manifestFile,
      moduleManifests: () => [manifestFile]
    }).connect()

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

    await createWordIntegration({
      run,
      caFile,
      manifestFile,
      moduleManifests: () => [manifestFile]
    }).connect()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', 'old-dev-id', '/f'])
    expect(run).not.toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
    expect(run).not.toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', 'someone-else', '/f'])
  })

  it('does not ask Windows to trust a CA it already trusts', async () => {
    const run = commands({ 'certutil -user': { code: 0 } })

    await createWordIntegration({
      run,
      caFile,
      manifestFile,
      moduleManifests: () => [manifestFile]
    }).connect()

    expect(run).not.toHaveBeenCalledWith('certutil', expect.arrayContaining(['-addstore']))
  })

  it('stops when the user declines the Windows trust prompt', async () => {
    const run = vi.fn<RunCommand>(async () => ({ code: 1, stdout: '' }))

    await expect(
      createWordIntegration({ run, caFile, manifestFile, moduleManifests: () => [manifestFile] }).connect()
    ).rejects.toThrow(/Windows did not trust/)
    expect(run).not.toHaveBeenCalledWith('reg', expect.anything())
  })

  it('disconnects by removing the registration', async () => {
    const run = commands({})

    await createWordIntegration({ run, caFile, manifestFile }).disconnect()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
  })

  it('fails when Office refuses the registration', async () => {
    const run = commands({ 'reg add': { code: 5 } })

    await expect(
      createWordIntegration({ run, caFile, manifestFile, moduleManifests: () => [manifestFile] }).connect()
    ).rejects.toThrow(/Could not add Stylistic to Word/)
  })

  it('refuses a manifest without an add-in id instead of registering an empty name', async () => {
    writeFileSync(manifestFile, '<OfficeApp></OfficeApp>')
    const run = commands({})

    await expect(
      createWordIntegration({ run, caFile, manifestFile, moduleManifests: () => [manifestFile] }).connect()
    ).rejects.toThrow(/no <Id>/)
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

describe('module manifests', () => {
  /** The module's add-in id, another than the bundled add-in's. */
  const moduleId = 'c0ffee00-4f1e-4939-83c8-0ddba48f3dff'
  /** The components directory. */
  let components: string
  /** The module's stable manifest. */
  let moduleManifest: string
  /** Where the hash of the last registered module manifest is kept. */
  let hashFile: string

  beforeEach(() => {
    components = join(dir, 'components')
    mkdirSync(join(components, 'word-addin'), { recursive: true })
    moduleManifest = join(components, 'word-addin', 'manifest.xml')
    hashFile = join(components, 'word-addin.registered.sha256')
    writeFileSync(moduleManifest, `<OfficeApp><Id>${moduleId}</Id><Version>2.0.0.0</Version></OfficeApp>`)
  })

  /** The registry listing with these values. */
  const listing = (...values: [string, string][]) => ({
    code: 0,
    stdout: [developerKey, ...values.map(([name, path]) => `    ${name}    REG_SZ    ${path}`), ''].join(
      '\r\n'
    )
  })

  /** An integration with the module manifest installed (or `manifests`). */
  const word = (run: RunCommand, manifests = () => [moduleManifest]) =>
    createWordIntegration({
      run,
      caFile,
      manifestFile,
      moduleManifests: manifests,
      componentsRoot: components
    })

  /** The sha256 of the module manifest. */
  const hashOf = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex')

  /** The `reg add` of `file` under `id`. */
  const added = (id: string, file: string) => [
    'add',
    developerKey,
    '/v',
    id,
    '/t',
    'REG_SZ',
    '/d',
    file,
    '/f'
  ]

  it('registers the module manifest once Stylistic is in Word, and removes the bundled root-URL entry', async () => {
    const run = commands({ 'reg query': listing([addinId, manifestFile]) })

    await word(run).sync()

    expect(run).toHaveBeenCalledWith('reg', added(moduleId, moduleManifest))
    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
    expect(readFileSync(hashFile, 'utf8')).toBe(hashOf(moduleManifest))
  })

  it('does not register the module again while its manifest hash is unchanged', async () => {
    writeFileSync(hashFile, hashOf(moduleManifest))
    const run = commands({ 'reg query': listing([moduleId, moduleManifest]) })

    await word(run).sync()

    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['add']))
    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['delete']))
  })

  it('registers the module again when its manifest content changes', async () => {
    writeFileSync(hashFile, 'an older hash')
    const run = commands({ 'reg query': listing([moduleId, moduleManifest]) })

    await word(run).sync()

    expect(run).toHaveBeenCalledWith('reg', added(moduleId, moduleManifest))
    expect(readFileSync(hashFile, 'utf8')).toBe(hashOf(moduleManifest))
  })

  it('drops the old add-in id when a changed module manifest names a new one', async () => {
    const run = commands({ 'reg query': listing(['older-module-id', moduleManifest]) })

    await word(run).sync()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', 'older-module-id', '/f'])
    expect(run).toHaveBeenCalledWith('reg', added(moduleId, moduleManifest))
  })

  it('adds nothing to Word while Stylistic is not in it', async () => {
    const run = commands({ 'reg query': listing(['someone-else', 'D:\\other\\manifest.xml']) })

    await word(run).sync()

    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['add']))
    expect(existsSync(hashFile)).toBe(false)
  })

  it('removes the module entry when no module is served any more, without registering the bundled manifest', async () => {
    // The module was uninstalled: its directory is gone, so its manifest file is gone too.
    rmSync(moduleManifest)
    const run = commands({ 'reg query': listing([moduleId, moduleManifest]) })

    await word(run, () => []).sync()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', moduleId, '/f'])
    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['add']))
  })

  it('keeps a live module registration while its files are still there, even with no module served', async () => {
    const run = commands({ 'reg query': listing([moduleId, moduleManifest]) })

    await word(run, () => []).sync()

    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['add']))
    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['delete']))
  })

  it('removes a stale bundled registration whose file is gone while no module is served', async () => {
    // An earlier hub installed the bundled add-in; the catalog-only update removed its files.
    rmSync(manifestFile)
    const run = commands({ 'reg query': listing([addinId, manifestFile]) })

    await word(run, () => []).sync()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
    expect(run).not.toHaveBeenCalledWith('reg', expect.arrayContaining(['add']))
  })

  it('ignores a stale bundled registration whose file is gone', async () => {
    rmSync(manifestFile)
    const run = commands({ certutil: { code: 0 }, 'reg query': listing([addinId, manifestFile]) })

    expect(await word(run, () => []).status()).toEqual({
      available: false,
      caTrusted: false,
      addinRegistered: false
    })
  })

  it('disconnect removes a stale bundled registration whose file is gone', async () => {
    rmSync(manifestFile)
    let listed = true
    const run = vi.fn<RunCommand>(async (command, args) => {
      if (command === 'reg' && args[0] === 'query') {
        return {
          code: 0,
          stdout: listed ? [developerKey, `    ${addinId}    REG_SZ    ${manifestFile}`, ''].join('\r\n') : ''
        }
      }
      if (command === 'reg' && args[0] === 'delete') listed = false
      return { code: 0, stdout: '' }
    })

    await word(run, () => []).disconnect()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
  })

  it('connects with the module manifest instead of the bundled one', async () => {
    const run = commands({ 'reg query': listing([addinId, manifestFile]) })

    await word(run).connect()

    expect(run).toHaveBeenCalledWith('reg', added(moduleId, moduleManifest))
    expect(run).not.toHaveBeenCalledWith('reg', added(addinId, manifestFile))
    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
    expect(readFileSync(hashFile, 'utf8')).toBe(hashOf(moduleManifest))
  })

  it('reports the module registered, with its version, and is available without the bundled add-in', async () => {
    rmSync(manifestFile)
    const run = commands({ certutil: { code: 0 }, 'reg query': listing([moduleId, moduleManifest]) })

    expect(await word(run).status()).toEqual({
      available: true,
      caTrusted: true,
      addinRegistered: true,
      version: '2.0.0.0'
    })
  })

  it('counts the bundled registration as Stylistic in Word until the module is registered', async () => {
    const run = commands({ 'reg query': listing([addinId, manifestFile]) })

    expect((await word(run).status()).addinRegistered).toBe(true)
  })

  it('disconnects the module and the bundled add-in', async () => {
    const run = commands({})

    await word(run).disconnect()

    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', moduleId, '/f'])
    expect(run).toHaveBeenCalledWith('reg', ['delete', developerKey, '/v', addinId, '/f'])
  })
})
