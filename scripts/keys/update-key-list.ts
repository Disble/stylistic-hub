// Changes the signed key list with the root key (docs/keys.md): rotates one online key or revokes one. Run it
// through update-key-list.ps1, which asks for the root passphrase and keeps it out of its log. A rotation sets the
// new private key as the target's GitHub secret through gh's stdin, never a file. Both bump `version`, reset
// `expires` (+13 months) and sign with the root key; commit keys/ afterwards, and the catalog job publishes it.
// Usage: bun scripts/keys/update-key-list.ts (--rotate <catalog|stylistic-hub|stylistic-addon> | --revoke <keyId>)
//   [--root <encrypted root key>] [--public <dir>]
import { createPrivateKey, type KeyObject } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { keyListSchema, type KeyList } from '../../src/shared/signing/documents'
import {
  entryFor,
  generateKey,
  listExpiry,
  ONLINE_KEYS,
  setGitHubSecret,
  signKeyList,
  type OnlineKeyTarget
} from './key-list'

/** What to change: rotate a target's key (named by its scope, or `catalog`), or revoke a key by id. */
export type KeyListChange = { rotate: string } | { revoke: string }

/** A target's name on the command line: its scope, or its role for the catalog key. */
function targetName(target: OnlineKeyTarget): string {
  return 'scope' in target ? target.scope : target.role
}

/** The entries left after the change; a rotation sets the new key's secret first. */
function changedKeys(
  keys: KeyList['keys'],
  change: KeyListChange,
  setSecret: (target: OnlineKeyTarget, pem: string) => void
): KeyList['keys'] {
  if ('revoke' in change) {
    if (!keys.some((key) => key.id === change.revoke)) throw new Error(`No key ${change.revoke} in the list`)
    return keys.filter((key) => key.id !== change.revoke)
  }
  const target = ONLINE_KEYS.find((candidate) => targetName(candidate) === change.rotate)
  if (!target) throw new Error(`Unknown target ${change.rotate}`)
  const scope = 'scope' in target ? target.scope : undefined
  const key = generateKey()
  setSecret(target, key.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
  return [
    ...keys.filter((entry) => entry.role !== target.role || entry.scope !== scope),
    entryFor(key.publicKey, target.role, scope)
  ]
}

/** The next key list after `change`, signed by the root key. */
export function updateKeyList(
  list: KeyList,
  change: KeyListChange,
  rootPrivateKey: KeyObject,
  now: Date,
  setSecret: (target: OnlineKeyTarget, pem: string) => void
): { list: KeyList; signature: string } {
  const next = {
    version: list.version + 1,
    expires: listExpiry(now),
    keys: changedKeys(list.keys, change, setSecret)
  }
  return { list: next, signature: signKeyList(next, rootPrivateKey) }
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      rotate: { type: 'string' },
      revoke: { type: 'string' },
      root: { type: 'string', default: join(homedir(), 'stylistic-root-keys', 'root.key.pem') },
      public: { type: 'string', default: 'keys' }
    }
  })
  const change: KeyListChange | undefined = values.rotate
    ? { rotate: values.rotate }
    : values.revoke
      ? { revoke: values.revoke }
      : undefined
  if (!change) throw new Error('Pass --rotate <target> or --revoke <keyId>')
  const root = createPrivateKey({
    key: readFileSync(values.root, 'utf8'),
    passphrase: process.env.STYLISTIC_ROOT_PASSPHRASE ?? ''
  })
  const file = join(values.public, 'keys.json')
  const current = keyListSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  const { list, signature } = updateKeyList(current, change, root, new Date(), setGitHubSecret)
  writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
  writeFileSync(join(values.public, 'keys.json.sig'), `${signature}\n`)
  console.log(`Key list: ${file} (version ${list.version}, expires ${list.expires})`)
  for (const entry of list.keys)
    console.log(`  ${entry.id} ${entry.role}${entry.scope ? ` ${entry.scope}` : ''}`)
}
