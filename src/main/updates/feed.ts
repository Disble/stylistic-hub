// The loopback feed of the hub's self-update (odd/tasks/update-engine.md S4, ADR D10): a node:http server on
// 127.0.0.1 and a random port that serves exactly `latest.yml` and the verified installer, for electron-updater's
// generic provider. The sha512 in latest.yml is computed from the same bytes whose sha256 and size are checked
// again against the signed component.json here; electron-updater re-checks that sha512 on what it downloads, so
// a file swapped after this check fails there instead of being installed.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { basename } from 'node:path'
import type { Component } from '../../shared/signing/documents'
import { verifyArtifact } from '../../shared/signing/verify'

/** An installer the engine downloaded and verified: the file and the signed component.json that pins it. */
export interface StagedInstaller {
  file: string
  component: Component
}

/** A running feed: the base URL to give electron-updater, and how to stop it. */
export interface Feed {
  /** `http://127.0.0.1:<port>/`. */
  url: string
  close(): Promise<void>
}

/** The `latest.yml` of `installer`, as JSON (a YAML subset, read by electron-updater's js-yaml). */
async function latestYml({ file, component }: StagedInstaller): Promise<string> {
  const bytes = await readFile(file)
  const measured = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  const check = verifyArtifact(component, measured)
  if (check !== 'ok') throw new Error(`${file} is not the verified installer: ${check}`)
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  const name = basename(file)
  const releaseDate = (await stat(file)).mtime.toISOString()
  // `files` is what electron-updater 6 reads; `path` and `sha512` are the deprecated fallback it still accepts.
  const info = { version: component.version, files: [{ url: name, sha512, size: bytes.length }], path: name }
  return JSON.stringify({ ...info, sha512, releaseDate })
}

/** Starts the feed of a verified installer; rejects when the file is not the one component.json pins. */
export async function startFeed(installer: StagedInstaller): Promise<Feed> {
  const yml = await latestYml(installer)
  const installerPath = `/${basename(installer.file)}`
  const server: Server = createServer((request, response) => {
    const { pathname } = new URL(String(request.url), 'http://127.0.0.1')
    if (request.method === 'GET' && pathname === '/latest.yml') {
      response.writeHead(200, { 'Content-Type': 'text/yaml' }).end(yml)
    } else if (request.method === 'GET' && pathname === installerPath) {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': installer.component.size
      })
      createReadStream(installer.file).pipe(response)
    } else {
      response.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
