import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OpenWorkflow } from 'openworkflow'
import { BackendSqlite } from 'openworkflow/sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunState, WorkflowEngine } from '../../ports/workflow-engine'
import { createOpenWorkflowEngine } from './engine'

/** Fresh folder for each test's engine database. */
let dir: string
/** The engine under test. */
let engine: WorkflowEngine & { stop(): Promise<void> }
/** Step names in the order the workflow ran them. */
let steps: string[]
/** What each workflow returned, by run id, so tests can see results the engine does not report. */
let outputs: Map<string, unknown>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hub-ow-'))
  steps = []
  outputs = new Map()
  engine = await createOpenWorkflowEngine({
    file: join(dir, 'workflows.db'),
    workflows: {
      double: async (input, step, run) => {
        const n = (input as { n: number }).n
        const doubled = await step.run('double', async () => {
          steps.push('double')
          return n * 2
        })
        outputs.set(run.id, { doubled })
        return { doubled }
      },
      // Fans out to `double` children and adds their results, as an analysis does with its chunks.
      fanOut: async (input, step, run) => {
        const ns = (input as { ns: number[] }).ns
        const children = await Promise.all(
          ns.map((n) => step.child<{ doubled: number }>(n < 0 ? 'broken' : 'double', { n }, `double-${n}`))
        )
        const sum = await step.run('sum', async () =>
          children.reduce((total, c) => total + (c.ok ? c.value.doubled : 0), 0)
        )
        const errors = children.flatMap((c) => (c.ok ? [] : [c.error]))
        outputs.set(run.id, { sum, errors })
        return sum
      },
      slow: async (_input, step) =>
        step.run('wait', async () => {
          await new Promise((resolve) => setTimeout(resolve, 300))
          steps.push('wait')
          return 'late'
        }),
      broken: async (_input, step) =>
        step.run('explode', async () => {
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
async function settle(id: string): Promise<RunState | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const state = await engine.get(id)
    if (state && state.status !== 'pending' && state.status !== 'running') return state
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return engine.get(id)
}

describe('createOpenWorkflowEngine', { timeout: 15_000 }, () => {
  it('runs a workflow through its steps and gives it its run id', async () => {
    const id = await engine.start('double', { n: 21 })

    expect(await settle(id)).toEqual({ status: 'completed' })
    expect(outputs.get(id)).toEqual({ doubled: 42 })
    expect(steps).toEqual(['double'])
  })

  it('runs child workflows in parallel and gives the parent their results', async () => {
    const id = await engine.start('fanOut', { ns: [1, 2, 3] })

    expect(await settle(id)).toEqual({ status: 'completed' })
    expect(outputs.get(id)).toEqual({ sum: 12, errors: [] })
    expect(steps).toEqual(['double', 'double', 'double'])
  })

  it('hands the parent a failed child as a result with its error, and the parent goes on', async () => {
    const id = await engine.start('fanOut', { ns: [1, -1, 3] })

    expect(await settle(id)).toEqual({ status: 'completed' })
    expect(outputs.get(id)).toEqual({ sum: 8, errors: ['kaboom'] })
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

  it('treats canceling a finished run as done', async () => {
    const id = await engine.start('double', { n: 2 })
    await settle(id)

    await expect(engine.cancel(id)).resolves.toBeUndefined()
    expect(await engine.get(id)).toEqual({ status: 'completed' })
  })

  it('finishes runs a previous backend left open, since their state lives in the hub database', async () => {
    const file = join(dir, 'leftover.db')
    const backend = BackendSqlite.connect(file)
    const leftover = await new OpenWorkflow({ backend })
      .defineWorkflow<unknown, unknown>({ name: 'double' }, async () => 'never')
      .run({ n: 1 })
    await backend.stop()

    const restarted = await createOpenWorkflowEngine({
      file,
      workflows: { double: async (_input, step) => step.run('again', async () => 'ran') }
    })
    let state = await restarted.get(leftover.workflowRun.id)
    for (let i = 0; i < 200 && state?.status !== 'completed'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      state = await restarted.get(leftover.workflowRun.id)
    }
    await restarted.stop()

    expect(state).toEqual({ status: 'completed' })
  })

  it('cancels left-over runs of workflows it no longer has', async () => {
    const file = join(dir, 'retired.db')
    const backend = BackendSqlite.connect(file)
    const leftover = await new OpenWorkflow({ backend })
      .defineWorkflow<unknown, unknown>({ name: 'stylistic-workflow' }, async () => 'never')
      .run({})
    await backend.stop()

    const restarted = await createOpenWorkflowEngine({ file, workflows: { double: async () => 'ran' } })
    const state = await restarted.get(leftover.workflowRun.id)
    await restarted.stop()

    expect(state).toEqual({ status: 'canceled' })
  })
})
