import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { SqlitePreferencesRepository } from './preferences-repository'

/** Fresh folder for each test's database file. */
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-prefs-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Opens the repository on this test's database file. */
function open() {
  const db = openDatabase(join(dir, 'stylistic.db'))
  return { db, repository: new SqlitePreferencesRepository(db) }
}

describe('SqlitePreferencesRepository', () => {
  it('has no correction instructions until some are saved', () => {
    const { db, repository } = open()

    expect(repository.getCorrectionInstructions()).toBeNull()
    db.close()
  })

  it('keeps saved instructions across connections, trimmed', () => {
    const first = open()
    expect(first.repository.setCorrectionInstructions('  Prefiero comillas angulares.\n')).toBe(
      'Prefiero comillas angulares.'
    )
    first.db.close()

    const second = open()
    expect(second.repository.getCorrectionInstructions()).toBe('Prefiero comillas angulares.')
    second.db.close()
  })

  it('clears the instructions with null or blank text', () => {
    const { db, repository } = open()
    repository.setCorrectionInstructions('Algo.')

    expect(repository.setCorrectionInstructions('   ')).toBeNull()
    expect(repository.getCorrectionInstructions()).toBeNull()
    repository.setCorrectionInstructions('Algo.')
    expect(repository.setCorrectionInstructions(null)).toBeNull()
    db.close()
  })
})
