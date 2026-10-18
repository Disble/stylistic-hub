// Packs out/server/ (from `bun run build:server`) as the signed server component of a release
// (docs/signed-releases.md), run by semantic-release's prepare step in `release:server`. Usage:
//   bun scripts/release/pack-server.ts --version <version> --channel <stable|beta> [--out <dir>]
import { parseArgs } from 'node:util'
// fallow-ignore-next-line boundary-violation -- the schema version is the migrations' own count; reading it from the database adapter keeps one source
import { openDatabase } from '../../src/backend/adapters/sqlite/database'
import type { Component } from '../../src/shared/signing/documents'
import { keyFromEnv } from '../keys/key-list'
import { packComponent } from './pack-component'

/** The command line: the version and channel semantic-release computed, and where the assets go. */
const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    channel: { type: 'string' },
    out: { type: 'string', default: 'out/server-release' }
  }
})

/** The SQLite schema version this server writes: the `user_version` a new database is migrated to. */
const schemaVersion = (() => {
  const db = openDatabase(':memory:')
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  db.close()
  return user_version
})()

/** The server release's version. */
const version = values.version ?? ''

/** The packed zip and the signed component.json describing it. */
const { zip, component } = await packComponent(
  {
    dir: 'out/server',
    out: values.out,
    id: 'server',
    kind: 'server',
    version,
    channel: values.channel as Component['channel'],
    requires: {},
    // minReaderSchema equals schemaVersion until expand/contract migrations record their own (roadmap M4).
    provides: { api: ['v1'], schemaVersion, minReaderSchema: schemaVersion },
    releaseNotes: `https://github.com/Disble/stylistic-hub/releases/tag/server-v${version}`
  },
  keyFromEnv('STYLISTIC_COMPONENT_KEY')
)
console.log(`${zip}: ${component.size} bytes, sha256 ${component.sha256}, schema ${schemaVersion}`)
