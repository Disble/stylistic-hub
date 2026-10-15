import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INITIAL_STYLE_PROFILE } from '../../profile/document-context'
import { openDatabase } from './database'
import { SqliteDocumentRepository } from './document-repository'

/** Fresh folder for each test's database file. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-docs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the repository on this test's database file. */
function open() {
  const db = openDatabase(join(dir, 'stylistic.db'))
  return { db, repository: new SqliteDocumentRepository(db) }
}

/** A document key as the add-in sends it. */
const KEY = '6f0c1a52-3d8e-4b6f-9a51-2c7d8e9f0a1b'

describe('SqliteDocumentRepository', () => {
  it('creates an unknown document with the defaults and the initial profile template', () => {
    const { db, repository } = open()

    expect(repository.resolve({ documentKey: KEY })).toEqual({
      documentKey: KEY,
      title: null,
      genre: 'general',
      processingConfig: { chunking: { mode: 'default' } },
      profileMarkdown: INITIAL_STYLE_PROFILE
    })
    db.close()
  })

  it('returns the same document on later calls and only overwrites what is given', () => {
    const { db, repository } = open()
    repository.resolve({ documentKey: KEY, title: 'Novela', genre: 'narrativa-literaria' })

    const again = repository.resolve({ documentKey: KEY })
    const retitled = repository.resolve({ documentKey: KEY, title: 'Novela, segunda parte' })

    expect(again.title).toBe('Novela')
    expect(again.genre).toBe('narrativa-literaria')
    expect(retitled.title).toBe('Novela, segunda parte')
    expect(retitled.genre).toBe('narrativa-literaria')
    db.close()
  })

  it('stores the processing configuration as given', () => {
    const { db, repository } = open()
    const processingConfig = { chunking: { mode: 'paragraph', size: 3 } }

    repository.resolve({ documentKey: KEY, processingConfig })

    expect(repository.resolve({ documentKey: KEY }).processingConfig).toEqual(processingConfig)
    db.close()
  })

  it('persists a profile update across restarts', () => {
    const first = open()
    first.repository.resolve({ documentKey: KEY })
    first.repository.updateStyleProfile(KEY, '# Updated profile')
    first.db.close()

    const second = open()

    expect(second.repository.resolve({ documentKey: KEY }).profileMarkdown).toBe('# Updated profile')
    second.db.close()
  })

  it('keeps documents apart', () => {
    const { db, repository } = open()
    const other = '0a1b2c3d-4e5f-4061-8728-394a5b6c7d8e'
    repository.resolve({ documentKey: KEY })
    repository.resolve({ documentKey: other })

    repository.updateStyleProfile(KEY, '# Mine')

    expect(repository.resolve({ documentKey: other }).profileMarkdown).toBe(INITIAL_STYLE_PROFILE)
    db.close()
  })

  it('fails to update the profile of a document it never resolved', () => {
    const { db, repository } = open()

    expect(() => repository.updateStyleProfile(KEY, '# Profile')).toThrow(/not found/)
    db.close()
  })
})
