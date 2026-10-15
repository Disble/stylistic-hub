// Builds stylistic-addon and copies its output into resources/addin, where the hub serves it from.
// Usage: bun run addin:bundle [path to stylistic-addon]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** The stylistic-addon checkout to build. */
const addon = resolve(process.argv[2] ?? '../stylistic-addon')
/** Where the hub serves the add-in from in development and packs it from. */
const target = resolve('resources/addin')

execFileSync('bun', ['run', 'build:hub'], {
  cwd: addon,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (!existsSync(join(addon, 'dist', 'manifest.xml'))) throw new Error(`No dist/manifest.xml in ${addon}`)
rmSync(target, { recursive: true, force: true })
cpSync(join(addon, 'dist'), target, { recursive: true })
console.log(`Bundled ${addon} into ${target}`)
