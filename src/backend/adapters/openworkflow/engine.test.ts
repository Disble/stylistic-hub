import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkflowEngine, WorkflowState } from '../../ports/workflow-engine'
import { createOpenWorkflowEngine } from './engine'

/** Fresh folder for each test's engine database. */
let dir: string
/** The engine under test. */
let engine: WorkflowEngine & { stop(): Promise<void> }
/** Step names in the order the workflow ran them. */
let steps: string[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hub-ow-'))
  steps = []
  engine = await createOpenWorkflowEngine({
    file: join(dir, 'workflows.db'),
    workflows: {
      double: async (input, step) => {
        const n = (input as { n: number }).n
        const doubled = await step('double', async () => {
          steps.push('double')
          return n * 2
        })
        return { doubled }
      },
      slow: async (_input, step) =>
        step('wait', async () => {
          await new Promise((resolve) => setTimeout(resolve, 300))
          steps.push('wait')
          return 'late'
        }),
      broken: async (_input, step) =>
        step('explode', async () => {
          throw new Error('kaboom')
        })
    },
    stepAttempts: 1
  })
})

afterEach(async () => {
  await engine.stop()
  rmSync(dir, { recursive: true, force: true })
})

/** Polls until the run leaves the running states. */
async function settle(id: string): Promise<WorkflowState | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const state = await engine.get(id)
    if (state && state.status !== 'pending' && state.status !== 'running') return state
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return engine.get(id)
}

describe('createOpenWorkflowEngine', { timeout: 15_000 }, () => {
  it('runs a workflow through its steps and returns the result', async () => {
    const id = await engine.start('double', { n: 21 })

    expect(await settle(id)).toEqual({ status: 'success', result: { doubled: 42 } })
    expect(steps).toEqual(['double'])
  })

  it('reports a failed workflow with the error message', async () => {
    const id = await engine.start('broken', {})

    const state = await settle(id)

    expect(state?.status).toBe('failed')
    expect(state?.error).toMatch(/kaboom/)
  })

  it('refuses a workflow it does not know', async () => {
    await expect(engine.start('missing', {})).rejects.toThrow(/Unknown workflow "missing"/)
  })

  it('has no state for an unknown run', async () => {
    expect(await engine.get('00000000-0000-4000-8000-000000000000')).toBeUndefined()
  })

  it('cancels a run', async () => {
    const id = await engine.start('slow', {})

    await engine.cancel(id)

    expect(await settle(id)).toEqual({ status: 'canceled' })
  })
})
