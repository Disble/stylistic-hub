import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
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
})
