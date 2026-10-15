import { describe, expect, it, vi } from 'vitest'
import type { WorkflowEngine, WorkflowState } from '../../ports/workflow-engine'
import { workflowRoutes } from './workflow-routes'

/** An engine that records what the routes ask of it. */
function fakeEngine(state: WorkflowState = { status: 'running' }) {
  return {
    start: vi.fn<WorkflowEngine['start']>(async () => 'engine-run-1'),
    get: vi.fn<WorkflowEngine['get']>(async () => state),
    cancel: vi.fn<WorkflowEngine['cancel']>(async () => {})
  }
}

/** The routes under test, mounted where the add-in's Mastra client calls them. */
function routesWith(engine: WorkflowEngine) {
  const routes = workflowRoutes(engine, ['stylistic-workflow'])
  return (path: string, init?: RequestInit) => routes.request(path, init)
}

/** A JSON POST. */
function post(body: unknown = {}): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/** Creates a run the way client-js does and returns its id. */
async function createRun(call: ReturnType<typeof routesWith>, query = ''): Promise<string> {
  const response = await call(`/stylistic-workflow/create-run${query}`, post())
  expect(response.status).toBe(200)
  return ((await response.json()) as { runId: string }).runId
}

describe('workflowRoutes', () => {
  it('describes a known workflow and 404s an unknown one', async () => {
    const call = routesWith(fakeEngine())

    expect(await (await call('/stylistic-workflow')).json()).toEqual({ name: 'stylistic-workflow' })
    expect((await call('/missing')).status).toBe(404)
    expect((await call('/missing/create-run', post())).status).toBe(404)
  })

  it('creates a run id, or keeps the one the client passes', async () => {
    const call = routesWith(fakeEngine())

    expect(await createRun(call)).toMatch(/^[0-9a-f-]{36}$/)
    expect(await createRun(call, '?runId=chosen')).toBe('chosen')
  })

  it('starts a created run with its input data and polls the engine state', async () => {
    const engine = fakeEngine({ status: 'success', result: { suggestions: [] } })
    const call = routesWith(engine)
    const runId = await createRun(call)

    const started = await call(
      `/stylistic-workflow/start?runId=${runId}`,
      post({ inputData: { text: 'Hola' } })
    )

    expect(started.status).toBe(200)
    expect(engine.start).toHaveBeenCalledWith('stylistic-workflow', { text: 'Hola' })
    const polled = await call(`/stylistic-workflow/runs/${runId}?fields=result,error`)
    expect(await polled.json()).toEqual({ status: 'success', result: { suggestions: [] } })
    expect(engine.get).toHaveBeenCalledWith('engine-run-1')
  })

  it('reports a created run as pending until it starts', async () => {
    const call = routesWith(fakeEngine())
    const runId = await createRun(call)

    expect(await (await call(`/stylistic-workflow/runs/${runId}`)).json()).toEqual({ status: 'pending' })
  })

  it('404s a run it does not know', async () => {
    const call = routesWith(fakeEngine())

    expect((await call('/stylistic-workflow/runs/nope')).status).toBe(404)
    expect((await call('/stylistic-workflow/start?runId=nope', post())).status).toBe(404)
    expect((await call('/stylistic-workflow/runs/nope/cancel', post())).status).toBe(404)
  })

  it('refuses a start without a run id and a second start of the same run', async () => {
    const call = routesWith(fakeEngine())
    const runId = await createRun(call)

    expect((await call('/stylistic-workflow/start', post())).status).toBe(400)
    await call(`/stylistic-workflow/start?runId=${runId}`, post({ inputData: {} }))
    expect((await call(`/stylistic-workflow/start?runId=${runId}`, post({ inputData: {} }))).status).toBe(409)
  })

  it('cancels a started run in the engine', async () => {
    const engine = fakeEngine()
    const call = routesWith(engine)
    const runId = await createRun(call)
    await call(`/stylistic-workflow/start?runId=${runId}`, post({ inputData: {} }))

    const canceled = await call(`/stylistic-workflow/runs/${runId}/cancel`, post())

    expect(canceled.status).toBe(200)
    expect(engine.cancel).toHaveBeenCalledWith('engine-run-1')
  })

  it('cancels a run that never started, which then cannot start', async () => {
    const engine = fakeEngine()
    const call = routesWith(engine)
    const runId = await createRun(call)

    await call(`/stylistic-workflow/runs/${runId}/cancel`, post())

    expect(await (await call(`/stylistic-workflow/runs/${runId}`)).json()).toEqual({ status: 'canceled' })
    expect((await call(`/stylistic-workflow/start?runId=${runId}`, post({ inputData: {} }))).status).toBe(409)
    expect(engine.cancel).not.toHaveBeenCalled()
  })

  it('starts a run once when two starts race', async () => {
    const engine = fakeEngine()
    const call = routesWith(engine)
    const runId = await createRun(call)

    const responses = await Promise.all([
      call(`/stylistic-workflow/start?runId=${runId}`, post({ inputData: {} })),
      call(`/stylistic-workflow/start?runId=${runId}`, post({ inputData: {} }))
    ])

    expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
    expect(engine.start).toHaveBeenCalledTimes(1)
  })
})
