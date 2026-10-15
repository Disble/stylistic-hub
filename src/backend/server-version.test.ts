import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SERVER_VERSION } from '../shared/versions'

describe('SERVER_VERSION', () => {
  it('is the version semantic-release writes into the server manifest', () => {
    const manifest = JSON.parse(readFileSync('src/backend/package.json', 'utf8')) as { version: string }

    expect(SERVER_VERSION).toBe(manifest.version)
  })
})
