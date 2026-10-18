import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addHistory, HISTORY_LIMIT, readState, updateState } from './state'

/** When set, the next rename fails, as a full disk or a lock would. */
const failRename = vi.hoisted(() => ({ next: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (failRename.next) {
        failRename.next = false
        throw new Error('EBUSY: rename failed')
      }
      return actual.rename(...args)
    }
  }
})

/** The components directory of the current test. */
let root: string

beforeEach(async () => {
  root = join(await mkdtemp(join(tmpdir(), 'stylistic-state-')), 'components')
})

afterEach(async () => {
  await rm(join(root, '..'), { recursive: true, force: true })
})

describe('state.json', () => {
  it('starts from serial 0 and key list version 0 when the hub never checked', async () => {
    expect(await readState(root)).toEqual({ serial: 0, keysVersion: 0, components: {}, history: [] })
  })

  it('keeps the newest 200 history entries', async () => {
    await updateState(root, (state) => {
      for (let index = 0; index < HISTORY_LIMIT + 5; index++) {
        addHistory(state, {
          time: String(index),
          component: 'server',
          from: null,
          to: '1.0.0',
          outcome: 'installed',
          reason: null
        })
      }
    })

    const { history } = await readState(root)
    expect(history).toHaveLength(200)
    expect(history[0]?.time).toBe('5')
    expect(history.at(-1)?.time).toBe('204')
  })

  it('lands every edit of concurrent updates and always leaves a parseable file', async () => {
    // The update check and a rollback can edit the state at the same time; none may lose the other's edit.
    for (let round = 0; round < 5; round++) {
      await rm(root, { recursive: true, force: true })
      await Promise.all([
        updateState(root, (state) => {
          state.components.server = { current: '1.0.0', previous: null, bad: ['0.9.0'], keyId: null }
        }),
        updateState(root, (state) => {
          state.serial = 2
        }),
        updateState(root, (state) => {
          state.keysVersion = 3
        })
      ])

      const raw = await readFile(join(root, 'state.json'), 'utf8')
      const state = JSON.parse(raw) as {
        serial: number
        keysVersion: number
        components: Record<string, unknown>
      }
      expect(state.serial).toBe(2)
      expect(state.keysVersion).toBe(3)
      expect(state.components.server).toMatchObject({ bad: ['0.9.0'] })
      expect(await readdir(root)).toEqual(['state.json'])
    }
  })

  it('leaves the previous file whole and no temporary file when a write fails', async () => {
    await updateState(root, (state) => {
      state.serial = 7
    })
    const before = await readFile(join(root, 'state.json'), 'utf8')
    failRename.next = true

    await expect(
      updateState(root, (state) => {
        state.serial = 8
      })
    ).rejects.toThrow('EBUSY')

    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(before)
    expect((await readState(root)).serial).toBe(7)
    expect(await readdir(root)).toEqual(['state.json'])
    // A failed write does not block the next one queued behind it.
    await updateState(root, (state) => {
      state.serial = 9
    })
    expect((await readState(root)).serial).toBe(9)
  })
})
