import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import type { WorkflowEngine } from '../../ports/workflow-engine'

/**
 * Where a client-side run id stands: created and waiting for its start, started as an engine run,
 * or canceled before it started.
 */
type RunEntry = { kind: 'created' } | { kind: 'started'; engineRunId: Promise<string> } | { kind: 'canceled' }

/**
 * The slice of Mastra's workflow API that the add-in's `@mastra/client-js` calls, so its
 * `MastraAdapter` keeps working against the hub: details, create-run, start, poll and cancel.
 * Mastra names the run before starting it, OpenWorkflow when it starts, so the routes keep the
 * mapping. It lives in memory: after a backend restart the add-in's open runs answer 404 and it
 * reports those chunks as failed.
 */
export function workflowRoutes(engine: WorkflowEngine, workflows: string[]): Hono {
  const runs = new Map<string, RunEntry>()
  const routes = new Hono()

  routes.use('/:workflow/*', async (c, next) => {
    if (!workflows.includes(c.req.param('workflow'))) return c.json({ error: 'Unknown workflow' }, 404)
    await next()
  })

  routes.get('/:workflow', (c) => {
    const name = c.req.param('workflow')
    return workflows.includes(name) ? c.json({ name }) : c.json({ error: 'Unknown workflow' }, 404)
  })

  routes.post('/:workflow/create-run', (c) => {
    const runId = c.req.query('runId') || randomUUID()
    // client-js re-creates a known run to cancel it: keep what it already is.
    if (!runs.has(runId)) runs.set(runId, { kind: 'created' })
    return c.json({ runId })
  })

  routes.post('/:workflow/start', async (c) => {
    const runId = c.req.query('runId')
    if (!runId) return c.json({ error: 'runId is required' }, 400)
    const body = await c.req.json<{ inputData?: unknown }>().catch(() => ({}) as { inputData?: unknown })
    // No await between this check and recording the start, so a racing second start gets 409.
    const entry = runs.get(runId)
    if (!entry) return c.json({ error: 'Unknown run' }, 404)
    if (entry.kind !== 'created') return c.json({ error: `Run already ${entry.kind}` }, 409)
    const engineRunId = engine.start(c.req.param('workflow'), body.inputData ?? {})
    runs.set(runId, { kind: 'started', engineRunId })
    try {
      await engineRunId
    } catch (error) {
      runs.set(runId, { kind: 'created' })
      throw error
    }
    return c.json({ message: 'Workflow run started' })
  })

  routes.get('/:workflow/runs/:runId', async (c) => {
    const entry = runs.get(c.req.param('runId'))
    if (!entry) return c.json({ error: 'Unknown run' }, 404)
    if (entry.kind === 'created') return c.json({ status: 'pending' })
    if (entry.kind === 'canceled') return c.json({ status: 'canceled' })
    const state = await engine.get(await entry.engineRunId)
    return state ? c.json(state) : c.json({ error: 'Unknown run' }, 404)
  })

  routes.post('/:workflow/runs/:runId/cancel', async (c) => {
    const runId = c.req.param('runId')
    const entry = runs.get(runId)
    if (!entry) return c.json({ error: 'Unknown run' }, 404)
    if (entry.kind === 'started') await engine.cancel(await entry.engineRunId)
    else runs.set(runId, { kind: 'canceled' })
    return c.json({ message: 'Workflow run canceled' })
  })

  return routes
}
