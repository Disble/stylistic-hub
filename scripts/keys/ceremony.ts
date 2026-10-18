// The one-time signing key ceremony (docs/keys.md). Run it through ceremony.ps1, which asks for the root
// passphrase and keeps it out of its log. Private keys are never printed: the root keys are written encrypted to --out,
// and the online keys go straight to GitHub secrets through gh's stdin, never to a file.
// Usage: bun scripts/keys/ceremony.ts [--out <dir>] [--dry-run]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { KeyObject } from 'node:crypto'
import { keyId, rawPublicKey } from '../../src/shared/signing/keys'
import { createKeyList, entryFor, generateKey, ONLINE_KEYS, setGitHubSecret, signKeyList } from './key-list'

/** The shortest root passphrase accepted. */
const MIN_PASSPHRASE = 12

/** Value of `--name <value>` on the command line. */
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

/** Rehearsal: no GitHub secrets are set. */
const dryRun = process.argv.includes('--dry-run')
/** Where the encrypted root private keys are written. */
const out = resolve(option('--out') ?? join(homedir(), 'stylistic-root-keys'))
/** Where the public key list and root public keys are written (committed). */
const publicDir = resolve(option('--public') ?? 'keys')
/** The root passphrase, set by ceremony.ps1 for this process only. */
const passphrase = process.env.STYLISTIC_ROOT_PASSPHRASE ?? ''

if (passphrase.length < MIN_PASSPHRASE) {
  throw new Error(
    `The root passphrase must have at least ${MIN_PASSPHRASE} characters (STYLISTIC_ROOT_PASSPHRASE)`
  )
}
for (const existing of [join(out, 'root.key.pem'), join(publicDir, 'keys.json')]) {
  if (existsSync(existing))
    throw new Error(`${existing} already exists: the ceremony runs once; rotate with the root key instead`)
}

/** An encrypted PKCS#8 PEM of a root private key. */
function encrypted(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase }).toString()
}

/** The root key pair: signs the key list. */
const root = generateKey()
/** The next root key pair, embedded one release ahead for a root rotation. */
const nextRoot = generateKey()
/** The online key pairs, one per secret. */
const online = ONLINE_KEYS.map((target) => ({ ...target, key: generateKey() }))

// Secrets first: if gh fails, nothing is written and the ceremony can run again.
for (const { key, ...target } of online) {
  const pem = key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  if (dryRun) console.log(`[dry run] would set ${target.secret} in ${target.repo}`)
  else setGitHubSecret(target, pem)
}

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'root.key.pem'), encrypted(root.privateKey), { mode: 0o600 })
writeFileSync(join(out, 'root-next.key.pem'), encrypted(nextRoot.privateKey), { mode: 0o600 })

/** The first key list, signed by the root key. */
const list = createKeyList(
  online.map(({ key, role, ...target }) =>
    entryFor(key.publicKey, role, 'scope' in target ? target.scope : undefined)
  )
)
mkdirSync(publicDir, { recursive: true })
writeFileSync(join(publicDir, 'keys.json'), `${JSON.stringify(list, null, 2)}\n`)
writeFileSync(join(publicDir, 'keys.json.sig'), `${signKeyList(list, root.privateKey)}\n`)
for (const [name, key] of [
  ['root.pub', root],
  ['root-next.pub', nextRoot]
] as const) {
  const raw = rawPublicKey(key.publicKey)
  writeFileSync(
    join(publicDir, name),
    `${JSON.stringify({ id: keyId(raw), publicKey: raw.toString('base64') }, null, 2)}\n`
  )
}

console.log(`Root keys (encrypted): ${out}`)
console.log(`Public key list: ${publicDir} (version ${list.version}, expires ${list.expires})`)
for (const entry of list.keys)
  console.log(`  ${entry.id} ${entry.role}${entry.scope ? ` ${entry.scope}` : ''}`)
console.log(
  `Root ${keyId(rawPublicKey(root.publicKey))}, next root ${keyId(rawPublicKey(nextRoot.publicKey))}`
)
