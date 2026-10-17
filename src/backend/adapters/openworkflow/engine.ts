import { OpenWorkflow } from 'openworkflow'
import { BackendSqlite } from 'openworkflow/sqlite'
import type {
  ChildResult,
  RunState,
  RunStatus,
  Step,
  WorkflowBody,
  WorkflowEngine
} from '../../ports/workflow-engine'

/** What the engine runs and where it keeps its runs. */
export interface OpenWorkflowEngineOptions {
  /** OpenWorkflow's own SQLite file, apart from the hub's database. */
  file: string
  workflows: Record<string, WorkflowBody>
  /** Tries per step before the run fails; Mastra's model pools retried 3 times. */
  stepAttempts?: number
  /** Runs worked on at once; a parent waiting for its children frees its slot. */
  concurrency?: number
}

/** OpenWorkflow's statuses in the port's words. */
const STATUS: Record<string, RunStatus> = {
  pending: 'pending',
  running: 'running',
  sleeping: 'running',
  succeeded: 'completed',
  completed: 'completed',
  failed: 'failed',
  canceled: 'canceled'
}

/**
 * The error a finished child failed with. OpenWorkflow fails a child step terminally and throws a
 * `StepError` (not exported) carrying the child's own error; anything else it throws from
 * `runWorkflow` pauses or fences the run and must reach OpenWorkflow untouched.
 */
function childFailure(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== 'StepError') return undefined
  const original = (error as Error & { originalError?: unknown }).originalError
  return original instanceof Error ? original.message : error.message
}

/** The workflow engine on OpenWorkflow with its SQLite backend; `stop` ends the worker. */
export async function createOpenWorkflowEngine({
  file,
  workflows,
  stepAttempts = 3,
  concurrency = 4
}: OpenWorkflowEngineOptions): Promise<WorkflowEngine & { stop(): Promise<void> }> {
  const backend = BackendSqlite.connect(file)
  const ow = new OpenWorkflow({ backend })
  const retryPolicy = { maximumAttempts: stepAttempts }
  const defined = new Map<string, ReturnType<typeof ow.defineWorkflow<unknown, unknown>>>()
  for (const [name, body] of Object.entries(workflows)) {
    defined.set(
      name,
      ow.defineWorkflow<unknown, unknown>({ name }, ({ input, step, run }) => {
        const steps: Step = {
          run: (stepName, fn) => step.run({ name: stepName, retryPolicy }, fn),
          child: async <T>(
            workflow: string,
            childInput: unknown,
            stepName: string
          ): Promise<ChildResult<T>> => {
            const child = defined.get(workflow)
            if (!child) throw new Error(`Unknown workflow "${workflow}"`)
            try {
              return {
                ok: true,
                value: (await step.runWorkflow(child.workflow.spec, childInput, { name: stepName })) as T
              }
            } catch (error) {
              const failure = childFailure(error)
              if (failure === undefined) throw error
              return { ok: false, error: failure }
            }
          }
        }
        return body(input, steps, { id: run.id })
      })
    )
  }
  // Open runs resume: what they produce lands in the hub's tables. Runs of a workflow the hub no
  // longer has (the Mastra-era ids) would only fail, so they are canceled.
  for (const status of ['pending', 'running', 'sleeping'] as const) {
    for (const run of (await backend.listWorkflowRuns({ status, limit: 1000 })).data) {
      if (!defined.has(run.workflowName)) await ow.cancelWorkflowRun(run.id)
    }
  }
  const worker = ow.newWorker({ concurrency })
  await worker.start()

  return {
    async start(workflow, input) {
      const definition = defined.get(workflow)
      if (!definition) throw new Error(`Unknown workflow "${workflow}"`)
      const handle = await definition.run(input)
      return handle.workflowRun.id
    },
    async get(runId): Promise<RunState | undefined> {
      const run = await backend.getWorkflowRun({ workflowRunId: runId })
      if (!run) return undefined
      const status = STATUS[run.status] ?? 'failed'
      return status === 'failed' ? { status, error: run.error?.message ?? 'The run failed' } : { status }
    },
    async cancel(runId) {
      try {
        await ow.cancelWorkflowRun(runId)
      } catch (error) {
        // OpenWorkflow refuses to cancel a finished run; for the hub that cancel is simply done.
        const run = await backend.getWorkflowRun({ workflowRunId: runId })
        if (!run || !['succeeded', 'completed', 'failed', 'canceled'].includes(run.status)) throw error
      }
    },
    async stop() {
      await worker.stop()
      await backend.stop()
    }
  }
}
