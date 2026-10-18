// Second half of `bun run build:server` (docs/signed-releases.md): after vite has bundled the backend into
// out/server/entry.js, copies the hub's package.json and bun.lock beside it unchanged and installs the
// production dependencies from that lockfile, so the externals the bundle imports (`@earendil-works/*`) and
// their whole dependency closure resolve to the versions the hub was tested with, on every release.
import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where vite wrote the server bundle. */
const SERVER_DIR = 'out/server'

for (const file of ['package.json', 'bun.lock']) copyFileSync(file, join(SERVER_DIR, file))
execFileSync('bun', ['install', '--production', '--frozen-lockfile', '--ignore-scripts'], {
  cwd: SERVER_DIR,
  stdio: 'inherit'
})
