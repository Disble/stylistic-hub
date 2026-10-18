import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  buildScript,
  checkAddinBuild,
  HUB_ORIGIN,
  pointManifestAt,
  stageAddin
} from './addin-bundle-contract'

/** A manifest as the add-in's production build writes it. */
const CONTOSO_MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp>
  <Id>11111111-2222-3333-4444-555555555555</Id>
  <Version>1.0.0.0</Version>
  <IconUrl DefaultValue="https://www.contoso.com/assets/icon-32.png"/>
  <SupportUrl DefaultValue="https://www.contoso.com/help"/>
  <AppDomains>
    <AppDomain>https://www.contoso.com.example</AppDomain>
  </AppDomains>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://www.contoso.com/taskpane.html"/>
  </DefaultSettings>
  <bt:Url id="Taskpane.Url" DefaultValue="https://www.contoso.com/taskpane.html"/>
</OfficeApp>
`

/** A task pane page that meets the contract. */
const TASKPANE = '<html><head><title>Stylistic</title></head><body></body></html>'

/** Every directory a test made, removed once the file is done. */
const scratches: string[] = []
afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true })
})

/** A fresh directory outside the repository. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'addin-bundle-'))
  scratches.push(dir)
  return dir
}

/** An add-in `dist/` with the given files. */
function dist(files: Record<string, string>): string {
  const dir = scratch()
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  return dir
}

describe('buildScript', () => {
  it('uses build:hub when the checkout defines it', () => {
    expect(buildScript(JSON.stringify({ scripts: { build: 'a', 'build:hub': 'b' } }))).toBe('build:hub')
  })

  it('falls back to build when the checkout has no build:hub', () => {
    expect(buildScript(JSON.stringify({ scripts: { build: 'a', 'build:dev': 'b' } }))).toBe('build')
  })

  it('fails when the checkout has neither script', () => {
    expect(() => buildScript(JSON.stringify({ scripts: { test: 'x' } }))).toThrow(
      'The add-in package.json has no "build:hub" or "build" script'
    )
    expect(() => buildScript('{}')).toThrow('no "build:hub" or "build" script')
  })
})

describe('pointManifestAt', () => {
  it('replaces the task pane origin everywhere with the hub origin', () => {
    const manifest = pointManifestAt(CONTOSO_MANIFEST)
    expect(manifest).not.toContain('https://www.contoso.com/')
    expect(manifest).toContain('<SourceLocation DefaultValue="https://localhost:3000/taskpane.html"/>')
    expect(manifest).toContain('<IconUrl DefaultValue="https://localhost:3000/assets/icon-32.png"/>')
    expect(manifest).toContain('<SupportUrl DefaultValue="https://localhost:3000/help"/>')
    expect(manifest).toContain(
      '<bt:Url id="Taskpane.Url" DefaultValue="https://localhost:3000/taskpane.html"/>'
    )
  })

  it('leaves a host that only starts with the task pane origin alone', () => {
    expect(pointManifestAt(CONTOSO_MANIFEST)).toContain(
      '<AppDomain>https://www.contoso.com.example</AppDomain>'
    )
  })

  it('replaces a bare origin with no path', () => {
    const manifest = CONTOSO_MANIFEST.replace('https://www.contoso.com.example', 'https://www.contoso.com')
    expect(pointManifestAt(manifest)).toContain('<AppDomain>https://localhost:3000</AppDomain>')
  })

  it('leaves a manifest that already names the hub origin unchanged', () => {
    const hub = CONTOSO_MANIFEST.replaceAll('https://www.contoso.com/', `${HUB_ORIGIN}/`)
    expect(pointManifestAt(hub)).toBe(hub)
  })

  it('fails instead of leaving the manifest on an origin it could not replace', () => {
    const upper = CONTOSO_MANIFEST.replaceAll('https://www.contoso.com/', 'https://WWW.Contoso.com/')
    expect(() => pointManifestAt(upper)).toThrow(
      'The add-in manifest names its task pane at https://WWW.Contoso.com/taskpane.html, whose origin the hub could not replace with https://localhost:3000'
    )
  })

  it('fails when the manifest has no task pane source location', () => {
    expect(() => pointManifestAt('<OfficeApp><Id>x</Id></OfficeApp>')).toThrow(
      'The add-in manifest has no task pane <SourceLocation DefaultValue="…"> in <DefaultSettings>'
    )
  })
})

describe('checkAddinBuild', () => {
  it('accepts a build that meets the contract', () => {
    expect(checkAddinBuild(dist({ 'manifest.xml': CONTOSO_MANIFEST, 'taskpane.html': TASKPANE }))).toEqual([])
  })

  it('names every missing file', () => {
    const dir = dist({})
    expect(checkAddinBuild(dir)).toEqual([
      `${join(dir, 'manifest.xml')} is missing`,
      `${join(dir, 'taskpane.html')} is missing`
    ])
  })

  it('names a task pane page without </head>', () => {
    const dir = dist({ 'manifest.xml': CONTOSO_MANIFEST, 'taskpane.html': '<html><body></body></html>' })
    expect(checkAddinBuild(dir)).toEqual([
      `${join(dir, 'taskpane.html')} has no </head>, where the hub puts the token meta tag`
    ])
  })

  it('names a manifest without a task pane source location', () => {
    const dir = dist({ 'manifest.xml': '<OfficeApp></OfficeApp>', 'taskpane.html': TASKPANE })
    expect(checkAddinBuild(dir)).toEqual([
      `${join(dir, 'manifest.xml')} has no task pane <SourceLocation DefaultValue="…"> in <DefaultSettings>`
    ])
  })
})

describe('stageAddin', () => {
  it('replaces the target with the build pointed at the hub, without source maps and with Stylistic.docx', () => {
    const source = dist({
      'manifest.xml': CONTOSO_MANIFEST,
      'taskpane.html': TASKPANE,
      'taskpane.js': 'run()',
      'taskpane.js.map': '{}',
      'assets/icon-32.png': 'png'
    })
    const target = join(scratch(), 'addin')
    mkdirSync(target)
    writeFileSync(join(target, 'stale.js'), 'old')

    stageAddin(source, target)

    expect(readFileSync(join(target, 'manifest.xml'), 'utf8')).toBe(pointManifestAt(CONTOSO_MANIFEST))
    expect(readFileSync(join(target, 'taskpane.js'), 'utf8')).toBe('run()')
    expect(existsSync(join(target, 'assets', 'icon-32.png'))).toBe(true)
    expect(existsSync(join(target, 'taskpane.js.map'))).toBe(false)
    expect(existsSync(join(target, 'stale.js'))).toBe(false)
    expect(existsSync(join(target, 'Stylistic.docx'))).toBe(true)
    // The original build is left as it was.
    expect(readFileSync(join(source, 'manifest.xml'), 'utf8')).toBe(CONTOSO_MANIFEST)
  })

  it('creates the target when there was none', () => {
    const source = dist({ 'manifest.xml': CONTOSO_MANIFEST, 'taskpane.html': TASKPANE })
    const target = join(scratch(), 'addin')
    stageAddin(source, target)
    expect(existsSync(join(target, 'manifest.xml'))).toBe(true)
  })

  it('fails with what is missing and leaves the previous target in place', () => {
    const source = dist({ 'taskpane.html': '<html></html>' })
    const parent = scratch()
    const target = join(parent, 'addin')
    mkdirSync(target)
    writeFileSync(join(target, 'manifest.xml'), 'previous')

    expect(() => stageAddin(source, target)).toThrow(
      `The add-in build in ${source} does not meet the hub's contract (docs/addin-contract.md):\n` +
        `- ${join(source, 'manifest.xml')} is missing\n` +
        `- ${join(source, 'taskpane.html')} has no </head>, where the hub puts the token meta tag`
    )
    expect(readFileSync(join(target, 'manifest.xml'), 'utf8')).toBe('previous')
    expect(existsSync(join(parent, '.addin-staging'))).toBe(false)
  })
})
