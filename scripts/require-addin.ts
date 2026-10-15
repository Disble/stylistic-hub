// Stops `bun run dist` before packaging an installer that could not add Stylistic to Word.
import { existsSync } from 'node:fs'

if (!existsSync('resources/addin/manifest.xml')) {
  console.error('resources/addin is missing: run `bun run addin:bundle [path to stylistic-addon]` first.')
  process.exit(1)
}
