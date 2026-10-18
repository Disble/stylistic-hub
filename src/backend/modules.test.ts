import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadModules } from './modules'

/** Temp folder holding the module directories. */
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hub-modules-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A module directory whose manifest names `version`. */
function moduleDir(name: string, version: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  writeFileSync(
    join(dir, 'manifest.xml'),
    `<?xml version="1.0"?><OfficeApp><Id>x</Id><Version>${version}</Version></OfficeApp>`
  )
  return dir
}

describe('loadModules', () => {
  it('serves no module when STYLISTIC_MODULES is absent', () => {
    expect(loadModules(undefined)).toEqual([])
  })

  it("reads each module's directory, its API scopes and the version its manifest names", () => {
    const dir = moduleDir('addin', '1.2.3.0')

    expect(
      loadModules(JSON.stringify({ 'stylistic-addon': { dir, scopes: ['status', 'analyses'] } }))
    ).toEqual([{ id: 'stylistic-addon', dir, version: '1.2.3.0', scopes: ['status', 'analyses'] }])
  })

  it('refuses a value that is not JSON', () => {
    expect(() => loadModules('{stylistic-addon')).toThrow(/^STYLISTIC_MODULES is not JSON/)
  })

  it.each([
    ['an id that is not a component id', { '../x': { dir: 'C:\\m', scopes: [] } }],
    ['a relative directory', { 'stylistic-addon': { dir: 'm/addin', scopes: [] } }],
    ['a value that is not an object', ['C:\\m']],
    ['a module given as a bare directory', { 'stylistic-addon': 'C:\\m' }],
    ['a module without scopes', { 'stylistic-addon': { dir: 'C:\\m' } }],
    ['a scope that is not an API route group', { 'stylistic-addon': { dir: 'C:\\m', scopes: ['admin'] } }]
  ])('refuses %s', (_case, value) => {
    expect(() => loadModules(JSON.stringify(value))).toThrow(/^STYLISTIC_MODULES must be/)
  })

  it('refuses a module whose manifest names no version', () => {
    const dir = join(root, 'empty')
    mkdirSync(dir)

    expect(() => loadModules(JSON.stringify({ 'stylistic-addon': { dir, scopes: [] } }))).toThrow(
      /^STYLISTIC_MODULES: module stylistic-addon has no <Version> in .*manifest\.xml/
    )
  })
})
