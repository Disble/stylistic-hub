import { OpenWorkflow } from 'openworkflow'
import { BackendSqlite } from 'openworkflow/sqlite'
import type { WorkflowBody, WorkflowEngine, WorkflowState, WorkflowStatus } from '../../ports/workflow-engine'

/** What the engine runs and where it keeps its runs. */
export interface OpenWorkflowEngineOptions {
  /** OpenWorkflow's own SQLite file, apart from the hub's database. */
  file: string
  workflows: Record<string, WorkflowBody>
  /** Tries per step before the run fails; Mastra's model pools retried 3 times. */
  stepAttempts?: number
  /** Runs worked on at once: the add-in sends a document's chunks in parallel. */
  concurrency?: number
}

/** OpenWorkflow's statuses in the add-in's words. */
const STATUS: Record<string, WorkflowStatus> = {
  pending: 'pending',
  running: 'running',
  sleeping: 'running',
  succeeded: 'success',
  completed: 'success',
  failed: 'failed',
  canceled: 'canceled'
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
  const defined = new Map(
    Object.entries(workflows).map(([name, body]) => [
      name,
      ow.defineWorkflow<unknown, unknown>({ name }, ({ input, step }) =>
        body(input, (stepName, run) => step.run({ name: stepName, retryPolicy }, run))
      )
    ])
  )
  const worker = ow.newWorker({ concurrency })
  await worker.start()

  return {
    async start(workflow, input) {
      const definition = defined.get(workflow)
      if (!definition) throw new Error(`Unknown workflow "${workflow}"`)
      const handle = await definition.run(input)
      return handle.workflowRun.id
    },
    async get(runId): Promise<WorkflowState | undefined> {
      const run = await backend.getWorkflowRun({ workflowRunId: runId })
      if (!run) return undefined
      const status = STATUS[run.status] ?? 'failed'
      if (status === 'success') return { status, result: run.output }
      if (status === 'failed') return { status, error: run.error?.message ?? 'The run failed' }
      return { status }
    },
    async cancel(runId) {
      await ow.cancelWorkflowRun(runId)
    },
    async stop() {
      await worker.stop()
      await backend.stop()
    }
  }
}
