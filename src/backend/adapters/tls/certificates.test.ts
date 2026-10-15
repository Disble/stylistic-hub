import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateKey, webcrypto, X509Certificate } from 'node:crypto'
import 'reflect-metadata'
import { AsnConvert } from '@peculiar/asn1-schema'
import { NameConstraints } from '@peculiar/asn1-x509'
import * as x509 from '@peculiar/x509'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureCertificates } from './certificates'

/** Fresh certificates folder for each test. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-certs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The names a CA certificate is allowed to sign for, read from its name constraints. */
function permittedNames(caPem: string) {
  const extension = new x509.X509Certificate(caPem).getExtension('2.5.29.30')
  if (!extension) return undefined
  const constraints = AsnConvert.parse(extension.value, NameConstraints)
  return {
    critical: extension.critical,
    names: (constraints.permittedSubtrees ?? []).map(
      (subtree) => subtree.base.dNSName ?? subtree.base.iPAddress
    )
  }
}

describe('ensureCertificates', () => {
  it('creates a localhost certificate signed by a local CA', async () => {
    const result = await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))
    const leaf = new X509Certificate(result.cert)
    const ca = new X509Certificate(result.caCert)

    expect(leaf.subjectAltName).toContain('DNS:localhost')
    expect(leaf.subjectAltName).toContain('IP Address:127.0.0.1')
    expect(leaf.checkIssued(ca)).toBe(true)
    expect(leaf.verify(ca.publicKey)).toBe(true)
    expect(ca.ca).toBe(true)
    expect(leaf.ca).toBe(false)
    expect(ca.subject).toContain('Stylistic Hub')
    expect(result.key).toContain('PRIVATE KEY')
  })

  it('reuses the certificates it already wrote', async () => {
    const now = new Date('2026-10-15T00:00:00Z')
    const first = await ensureCertificates(dir, now)
    const second = await ensureCertificates(dir, now)

    expect(second.cert).toBe(first.cert)
    expect(second.caCert).toBe(first.caCert)
  })

  it('renews the leaf, keeping the CA, when it expires within 30 days', async () => {
    const first = await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))
    const leaf = new X509Certificate(first.cert)
    const nearExpiry = new Date(new Date(leaf.validTo).getTime() - 10 * 24 * 60 * 60 * 1000)

    const renewed = await ensureCertificates(dir, nearExpiry)

    expect(renewed.cert).not.toBe(first.cert)
    expect(renewed.caCert).toBe(first.caCert)
    expect(new X509Certificate(renewed.cert).checkIssued(new X509Certificate(renewed.caCert))).toBe(true)
  })

  it('starts over when the stored files are unreadable', async () => {
    const first = await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))
    writeFileSync(join(dir, 'ca.pem'), 'garbage')

    const second = await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))

    expect(second.caCert).not.toBe(first.caCert)
    expect(readFileSync(join(dir, 'ca.pem'), 'utf8')).toBe(second.caCert)
  })

  it('reissues the leaf, keeping the CA, when the leaf key does not match its certificate', async () => {
    const now = new Date('2026-10-15T00:00:00Z')
    const first = await ensureCertificates(dir, now)
    const other = mkdtempSync(join(tmpdir(), 'hub-certs-other-'))
    const foreign = await ensureCertificates(other, now)
    rmSync(other, { recursive: true, force: true })
    writeFileSync(join(dir, 'localhost-key.pem'), foreign.key)

    const second = await ensureCertificates(dir, now)

    expect(second.caCert).toBe(first.caCert)
    expect(second.key).not.toBe(foreign.key)
    expect(new X509Certificate(second.cert).checkPrivateKey(createPrivateKey(second.key))).toBe(true)
  })

  it('starts over when the CA key is corrupt', async () => {
    const now = new Date('2026-10-15T00:00:00Z')
    const first = await ensureCertificates(dir, now)
    writeFileSync(join(dir, 'ca-key.pem'), 'garbage')

    const second = await ensureCertificates(dir, now)

    expect(second.caCert).not.toBe(first.caCert)
    expect(new X509Certificate(second.cert).checkIssued(new X509Certificate(second.caCert))).toBe(true)
  })

  it('reissues the leaf, keeping the CA, when the leaf certificate is corrupt or missing', async () => {
    const now = new Date('2026-10-15T00:00:00Z')
    const first = await ensureCertificates(dir, now)
    writeFileSync(join(dir, 'localhost.pem'), 'garbage')

    const corrupt = await ensureCertificates(dir, now)
    rmSync(join(dir, 'localhost.pem'))
    const missing = await ensureCertificates(dir, now)

    expect(corrupt.caCert).toBe(first.caCert)
    expect(missing.caCert).toBe(first.caCert)
    expect(new X509Certificate(missing.cert).checkIssued(new X509Certificate(first.caCert))).toBe(true)
  })

  it('limits the CA to the loopback names, so a leaked CA key cannot sign for other sites', async () => {
    const result = await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))

    expect(permittedNames(result.caCert)).toEqual({
      critical: true,
      names: ['localhost', '127.0.0.1/32', '::1/128']
    })
  })

  it('replaces a stored CA that has no name constraints', async () => {
    const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify'
    ])) as webcrypto.CryptoKeyPair
    const unconstrained = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber: '01',
      name: 'CN=Old CA',
      notBefore: new Date('2026-10-01T00:00:00Z'),
      notAfter: new Date('2036-10-01T00:00:00Z'),
      keys,
      signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
      extensions: [new x509.BasicConstraintsExtension(true, 0, true)]
    })
    const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64')
    await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))
    writeFileSync(join(dir, 'ca.pem'), unconstrained.toString('pem'))
    writeFileSync(
      join(dir, 'ca-key.pem'),
      `-----BEGIN PRIVATE KEY-----
${pkcs8}
-----END PRIVATE KEY-----
`
    )

    const result = await ensureCertificates(dir, new Date('2026-10-15T00:00:00Z'))

    expect(result.caCert).not.toBe(unconstrained.toString('pem'))
    expect(permittedNames(result.caCert)?.names).toContain('localhost')
  })
})
