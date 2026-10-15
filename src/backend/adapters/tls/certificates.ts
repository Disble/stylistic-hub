// @peculiar/x509 resolves its parsers through tsyringe, which needs this polyfill loaded first.
import 'reflect-metadata'
import { createPrivateKey, randomBytes, webcrypto, X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as x509 from '@peculiar/x509'

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0])

/** PEM material the HTTPS server and the trust installer need. */
export interface HubCertificates {
  /** Private key of the localhost certificate. */
  key: string
  /** The localhost certificate, signed by the local CA. */
  cert: string
  /** The local CA certificate, the one Windows is asked to trust. */
  caCert: string
}

/** Files kept in the certificates folder. */
const FILES = { caCert: 'ca.pem', caKey: 'ca-key.pem', cert: 'localhost.pem', key: 'localhost-key.pem' }

/** ECDSA P-256 with SHA-256, accepted by Chromium/WebView2 and Schannel. */
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' }

/** One day, in milliseconds. */
const DAY = 24 * 60 * 60 * 1000

/** Certificates are renewed when they expire within this window. */
const RENEW_WITHIN = 30 * DAY

/** The CA lasts ten years so Windows asks the user to trust it rarely. */
const CA_LIFETIME = 3650 * DAY

/** Leaves stay under the 398-day ceiling browsers enforce for server certificates. */
const LEAF_LIFETIME = 365 * DAY

/**
 * Loads the hub's local CA and localhost certificate from `dir`, creating or renewing them as
 * needed. The leaf is renewed with the same CA, so Windows keeps trusting it.
 */
export async function ensureCertificates(dir: string, now = new Date()): Promise<HubCertificates> {
  mkdirSync(dir, { recursive: true })
  const stored = readStored(dir)

  if (stored && isFresh(stored.caCert, now)) {
    if (leafUsable(stored, now)) {
      return { key: stored.key, cert: stored.cert, caCert: stored.caCert }
    }
    const caKey = await importPrivateKey(stored.caKey)
    const ca = new x509.X509Certificate(stored.caCert)
    const leaf = await createLeaf(ca, caKey, now)
    writeFileSync(join(dir, FILES.cert), leaf.cert)
    writeFileSync(join(dir, FILES.key), leaf.key)
    return { ...leaf, caCert: stored.caCert }
  }

  const ca = await createCa(now)
  const leaf = await createLeaf(ca.certificate, ca.keys.privateKey, now)
  const caCert = ca.certificate.toString('pem')
  writeFileSync(join(dir, FILES.caCert), caCert)
  writeFileSync(join(dir, FILES.caKey), await exportPrivateKey(ca.keys.privateKey))
  writeFileSync(join(dir, FILES.cert), leaf.cert)
  writeFileSync(join(dir, FILES.key), leaf.key)
  return { ...leaf, caCert }
}

/**
 * Reads the stored CA, or nothing when its files are missing, unparsable or do not belong
 * together. The leaf files are read as they are; a bad leaf is reissued with the same CA.
 */
function readStored(dir: string) {
  const read = (name: string) => {
    try {
      return readFileSync(join(dir, name), 'utf8')
    } catch {
      return ''
    }
  }
  const stored = {
    caCert: read(FILES.caCert),
    caKey: read(FILES.caKey),
    cert: read(FILES.cert),
    key: read(FILES.key)
  }
  return keyMatches(stored.caCert, stored.caKey) ? stored : undefined
}

/** True when the stored leaf parses, is fresh, was signed by the CA and matches its key. */
function leafUsable(stored: { caCert: string; cert: string; key: string }, now: Date): boolean {
  try {
    return (
      isFresh(stored.cert, now) && issuedBy(stored.cert, stored.caCert) && keyMatches(stored.cert, stored.key)
    )
  } catch {
    return false
  }
}

/** True when `keyPem` is the private key of the certificate in `certPem`. */
function keyMatches(certPem: string, keyPem: string): boolean {
  try {
    return new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem))
  } catch {
    return false
  }
}

/** True when the certificate is valid now and beyond the renewal window. */
function isFresh(pem: string, now: Date): boolean {
  const cert = new X509Certificate(pem)
  return new Date(cert.validFrom) <= now && new Date(cert.validTo).getTime() - now.getTime() > RENEW_WITHIN
}

/** True when `leafPem` was signed by the CA in `caPem`. */
function issuedBy(leafPem: string, caPem: string): boolean {
  const leaf = new X509Certificate(leafPem)
  const ca = new X509Certificate(caPem)
  return leaf.checkIssued(ca) && leaf.verify(ca.publicKey)
}

/** A random positive serial number. */
function serialNumber(): string {
  const bytes = randomBytes(16)
  bytes[0] = (bytes[0] ?? 0) & 0x7f
  return bytes.toString('hex')
}

/** Generates a fresh ECDSA key pair that can be exported. */
async function generateKeys(): Promise<webcrypto.CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify'])) as webcrypto.CryptoKeyPair
}

/** Creates the self-signed local CA. */
async function createCa(now: Date) {
  const keys = await generateKeys()
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: serialNumber(),
    name: 'CN=Stylistic Hub Local CA, O=Stylistic Hub',
    notBefore: new Date(now.getTime() - DAY),
    notAfter: new Date(now.getTime() + CA_LIFETIME),
    keys,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(true, 0, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey)
    ]
  })
  return { certificate, keys }
}

/** Creates the localhost server certificate, signed by the CA. */
async function createLeaf(ca: x509.X509Certificate, caKey: webcrypto.CryptoKey, now: Date) {
  const keys = await generateKeys()
  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: serialNumber(),
    subject: 'CN=localhost',
    issuer: ca.subject,
    notBefore: new Date(now.getTime() - DAY),
    notAfter: new Date(now.getTime() + LEAF_LIFETIME),
    signingKey: caKey,
    publicKey: keys.publicKey,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension([
        { type: 'dns', value: 'localhost' },
        { type: 'ip', value: '127.0.0.1' },
        { type: 'ip', value: '::1' }
      ]),
      await x509.AuthorityKeyIdentifierExtension.create(ca)
    ]
  })
  return { cert: certificate.toString('pem'), key: await exportPrivateKey(keys.privateKey) }
}

/** PKCS#8 PEM of a private key. */
async function exportPrivateKey(key: webcrypto.CryptoKey): Promise<string> {
  const der = await webcrypto.subtle.exportKey('pkcs8', key)
  return x509.PemConverter.encode(der, 'PRIVATE KEY')
}

/** Imports a stored PKCS#8 PEM private key for signing. */
async function importPrivateKey(pem: string): Promise<webcrypto.CryptoKey> {
  const der = x509.PemConverter.decode(pem)[0]
  if (!der) throw new Error('Empty private key file')
  return webcrypto.subtle.importKey('pkcs8', der, ALGORITHM, true, ['sign'])
}
