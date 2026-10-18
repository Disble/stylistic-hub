// Builds an add-in checkout and copies its output into resources/addin, where the hub serves it from in development
// and packs it from. The checkout builds with its `build:hub` script when it has one, else with `build`; the hub then
// checks the build against its contract and points the manifest at https://localhost:3000, whatever origin the build
// wrote. A build that breaks the contract fails with what is missing and leaves resources/addin as it was.
// Contract: docs/addin-contract.md.
// Usage: bun run addin:bundle [path to the add-in checkout, default ../stylistic-addon]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildScript, stageAddin } from './addin-bundle-contract'

/** The add-in checkout to build. */
const addon = resolve(process.argv[2] ?? '../stylistic-addon')
/** Where the hub serves the add-in from in development and packs it from. */
const target = resolve('resources/addin')

/** The checkout's script that builds it for the hub. */
const script = buildScript(readFileSync(join(addon, 'package.json'), 'utf8'))
execFileSync('bun', ['run', script], {
  cwd: addon,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
stageAddin(join(addon, 'dist'), target)
console.log(`Bundled ${addon} (bun run ${script}) into ${target}`)
