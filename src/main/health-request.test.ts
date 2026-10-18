import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, webcrypto } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import 'reflect-metadata'
import { AsnConvert } from '@peculiar/asn1-schema'
import {
  GeneralName,
  GeneralSubtree,
  GeneralSubtrees,
  id_ce_nameConstraints,
  NameConstraints
} from '@peculiar/asn1-x509'
import * as x509 from '@peculiar/x509'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { StatusRequest } from './health-check'
import { hubStatusRequest } from './health-request'

/** Fixtures own their crypto setup, without importing the backend composition or adapters. */
x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0])

/** The token the fixture servers expect to see, never a real secret. */
const token = '0'.repeat(64)

/** Scratch folders of the current test, all removed afterwards. */
let dirs: string[]
/** Fixture servers of the current test, all closed afterwards. */
let servers: Server[]

beforeEach(() => {
  dirs = []
  servers = []
})

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

/** Independent TLS fixtures retain the production loopback constraints and leaf identities. */
async function certified() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-health-'))
  dirs.push(dir)
  const certs = join(dir, 'certs')
  mkdirSync(certs)
  const ca = await mintCa(true)
  const leaf = await mintLeaf({
    caCert: ca.cert,
    caKeyPem: ca.keyPem,
    sans: [
      { type: 'dns', value: 'localhost' },
      { type: 'ip', value: '127.0.0.1' },
      { type: 'ip', value: '::1' }
    ],
    ...current()
  })
  const caFile = join(certs, 'ca.pem')
  const leafFile = join(certs, 'localhost.pem')
  writeFileSync(caFile, ca.cert)
  writeFileSync(leafFile, leaf.cert)
  return { dir, caFile, leafFile, key: leaf.key, caCert: ca.cert, caKeyPem: ca.keyPem }
}

/** Mints a fixture CA; the hostname-control fixture deliberately omits name constraints. */
async function mintCa(loopbackOnly = false) {
  const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])) as webcrypto.CryptoKeyPair
  const serial = randomBytes(16)
  serial[0] = (serial[0] ?? 0) & 0x7f
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serial.toString('hex'),
    name: 'CN=fixture CA',
    notBefore: new Date(Date.now() - 1000),
    notAfter: new Date(Date.now() + 86_400_000),
    keys,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      ...(loopbackOnly
        ? [
            new x509.Extension(
              id_ce_nameConstraints,
              true,
              AsnConvert.serialize(
                new NameConstraints({
                  permittedSubtrees: new GeneralSubtrees([
                    new GeneralSubtree({ base: new GeneralName({ dNSName: 'localhost' }) }),
                    new GeneralSubtree({ base: new GeneralName({ iPAddress: '127.0.0.1/32' }) }),
                    new GeneralSubtree({ base: new GeneralName({ iPAddress: '::1/128' }) })
                  ])
                })
              )
            )
          ]
        : [])
    ]
  })
  return {
    cert: certificate.toString('pem'),
    keyPem: x509.PemConverter.encode(
      await webcrypto.subtle.exportKey('pkcs8', keys.privateKey),
      'PRIVATE KEY'
    )
  }
}

/** Mints a leaf for `sans` from the fixture CA, with another key than the managed leaf. */
async function mintLeaf({
  caCert,
  caKeyPem,
  sans,
  notBefore,
  notAfter
}: {
  caCert: string
  caKeyPem: string
  sans: { type: 'dns' | 'ip'; value: string }[]
  notBefore: Date
  notAfter: Date
}) {
  const ca = new x509.X509Certificate(caCert)
  const caKeyDer = x509.PemConverter.decode(caKeyPem)[0]
  if (!caKeyDer) throw new Error('Empty fixture CA key')
  const caKey = await webcrypto.subtle.importKey(
    'pkcs8',
    caKeyDer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  )
  const keys = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify'
  ])) as webcrypto.CryptoKeyPair
  const serial = randomBytes(16)
  serial[0] = (serial[0] ?? 0) & 0x7f
  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: serial.toString('hex'),
    subject: 'CN=localhost',
    issuer: ca.subject,
    notBefore,
    notAfter,
    signingKey: caKey,
    publicKey: keys.publicKey,
    signingAlgorithm: { name: 'ECDSA', hash: 'SHA-256' },
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(sans)
    ]
  })
  return {
    cert: certificate.toString('pem'),
    key: x509.PemConverter.encode(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey), 'PRIVATE KEY')
  }
}

/** Serves 200 on every interface, recording the requests that passed the TLS handshake. */
async function serve({ key, cert }: { key: string; cert: string }) {
  const seen: { authorization: string | undefined; host: string | undefined }[] = []
  const server = createServer({ key, cert }, (req, res) => {
    seen.push({ authorization: req.headers['authorization'], host: req.headers['host'] })
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  servers.push(server)
  return { port: (server.address() as AddressInfo).port, seen }
}

/** A validity window around now. */
function current() {
  return { notBefore: new Date(Date.now() - 1000), notAfter: new Date(Date.now() + 86_400_000) }
}

/** Runs the request, returning the rejection it must produce. */
async function rejectionOf(request: StatusRequest): Promise<NodeJS.ErrnoException> {
  try {
    await request()
  } catch (error) {
    return error as NodeJS.ErrnoException
  }
  throw new Error('expected the health request to reject')
}

describe('hubStatusRequest', () => {
  it('keeps the CA trust mode: 200 with the token and the loopback Host', async () => {
    const { caFile, leafFile, key } = await certified()
    const { port, seen } = await serve({ key, cert: readFileSync(leafFile, 'utf8') })

    const code = await hubStatusRequest({ port, token, caFile })()

    expect(code).toBe(200)
    expect(seen).toEqual([{ authorization: `Bearer ${token}`, host: `localhost:${port}` }])
  })

  it('trusts the exact managed leaf in leaf mode', async () => {
    const { caFile, leafFile, key } = await certified()
    const { port } = await serve({ key, cert: readFileSync(leafFile, 'utf8') })

    const code = await hubStatusRequest({ port, token, caFile, leafFile })()

    expect(code).toBe(200)
  })

  it('rejects another same-CA localhost certificate, which a leaked CA key could mint', async () => {
    const { caFile, leafFile, caKeyPem, caCert } = await certified()
    const evil = await mintLeaf({
      caCert,
      caKeyPem,
      sans: [{ type: 'dns', value: 'localhost' }],
      ...current()
    })
    const { port, seen } = await serve(evil)

    const error = await rejectionOf(hubStatusRequest({ port, token, caFile, leafFile }))

    expect(error.code).toBe('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')
    expect(seen).toEqual([])
  })

  it('rejects a mixed localhost plus attacker-IP leaf', async () => {
    const { caFile, leafFile, caKeyPem, caCert } = await certified()
    const evil = await mintLeaf({
      caCert,
      caKeyPem,
      sans: [
        { type: 'dns', value: 'localhost' },
        { type: 'ip', value: '203.0.113.10' }
      ],
      ...current()
    })
    const { port, seen } = await serve(evil)

    const error = await rejectionOf(hubStatusRequest({ port, token, caFile, leafFile }))

    expect(error.code).toBe('UNABLE_TO_GET_ISSUER_CERT_LOCALLY')
    expect(seen).toEqual([])
  })

  it('rejects the pinned name itself when it does not match localhost', async () => {
    // A constraint-free fixture CA: the pinned leaf passes the chain, so only the default
    // hostname check can refuse it. The production CA would refuse it earlier at its constraints.
    const plain = await mintCa()
    const wrong = await mintLeaf({
      caCert: plain.cert,
      caKeyPem: plain.keyPem,
      sans: [{ type: 'dns', value: 'other.invalid' }],
      ...current()
    })
    const dir = mkdtempSync(join(tmpdir(), 'hub-health-'))
    dirs.push(dir)
    const plainFile = join(dir, 'plain-ca.pem')
    writeFileSync(plainFile, plain.cert)
    const wrongFile = join(dir, 'wrong.pem')
    writeFileSync(wrongFile, wrong.cert)
    const { port, seen } = await serve(wrong)

    const error = await rejectionOf(hubStatusRequest({ port, token, caFile: plainFile, leafFile: wrongFile }))

    expect(error.code).toBe('ERR_TLS_CERT_ALTNAME_INVALID')
    expect(seen).toEqual([])
  })

  it('rejects an expired pinned leaf', async () => {
    const { caFile, dir, caKeyPem, caCert } = await certified()
    const old = await mintLeaf({
      caCert,
      caKeyPem,
      sans: [
        { type: 'dns', value: 'localhost' },
        { type: 'ip', value: '127.0.0.1' },
        { type: 'ip', value: '::1' }
      ],
      notBefore: new Date('2020-01-01T00:00:00Z'),
      notAfter: new Date('2020-01-02T00:00:00Z')
    })
    const oldFile = join(dir, 'old.pem')
    writeFileSync(oldFile, old.cert)
    const { port, seen } = await serve(old)

    const error = await rejectionOf(hubStatusRequest({ port, token, caFile, leafFile: oldFile }))

    expect(error.code).toBe('CERT_HAS_EXPIRED')
    expect(seen).toEqual([])
  })

  it('never falls back to the CA when the pinned leaf is missing', async () => {
    const { caFile, leafFile, key } = await certified()
    const { port, seen } = await serve({ key, cert: readFileSync(leafFile, 'utf8') })

    const error = await rejectionOf(
      hubStatusRequest({ port, token, caFile, leafFile: join(leafFile, '..', 'rotated-away.pem') })
    )

    expect(error.code).toBe('ENOENT')
    expect(seen).toEqual([])
  })

  it('rereads the pinned leaf on every poll, so a renewal takes effect', async () => {
    const first = await certified()
    const second = await certified()
    const { port } = await serve({ key: second.key, cert: readFileSync(second.leafFile, 'utf8') })
    const pinFile = join(first.dir, 'pinned.pem')
    writeFileSync(pinFile, readFileSync(first.leafFile, 'utf8'))

    const request = () => hubStatusRequest({ port, token, caFile: first.caFile, leafFile: pinFile })()

    await expect(request()).rejects.toThrow()
    writeFileSync(pinFile, readFileSync(second.leafFile, 'utf8'))

    await expect(request()).resolves.toBe(200)
  })
})
