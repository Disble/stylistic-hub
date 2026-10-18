import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addHistory, HISTORY_LIMIT, readState, updateState } from './state'

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

  it('leaves the previous file whole and no temporary file when a write fails', async () => {
    await updateState(root, (state) => {
      state.serial = 7
    })
    const before = await readFile(join(root, 'state.json'), 'utf8')
    // A directory where the temporary file goes makes the write fail, as a full disk or a lock would.
    await mkdir(join(root, 'state.json.tmp', 'blocker'), { recursive: true })
    await writeFile(join(root, 'state.json.tmp', 'blocker', 'file'), 'x')

    await expect(
      updateState(root, (state) => {
        state.serial = 8
      })
    ).rejects.toThrow()

    expect(await readFile(join(root, 'state.json'), 'utf8')).toBe(before)
    expect((await readState(root)).serial).toBe(7)
    expect(await readdir(root)).toEqual(['state.json'])
  })
})
