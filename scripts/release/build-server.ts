// Second half of `bun run build:server` (docs/signed-releases.md): after vite has bundled the backend into
// out/server/entry.js, writes a package.json naming the Pi packages the bundle keeps external, at the exact
// versions the hub uses, and installs their production dependencies beside it.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where vite wrote the server bundle. */
const SERVER_DIR = 'out/server'

/** The hub's own dependencies, whose versions the server component pins. */
const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>
}

/** The packages the bundle imports at runtime: the externals of vite.server.config.ts that are not builtins. */
const runtime = Object.fromEntries(
  Object.entries(dependencies).filter(([name]) => name.startsWith('@earendil-works/'))
)

writeFileSync(
  join(SERVER_DIR, 'package.json'),
  `${JSON.stringify({ name: 'stylistic-server', private: true, type: 'module', main: 'entry.js', dependencies: runtime }, null, 2)}\n`
)
execFileSync('bun', ['install', '--production'], { cwd: SERVER_DIR, stdio: 'inherit' })
