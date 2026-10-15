/** Where a run is, in the status names the add-in already reads (Mastra's). */
export type WorkflowStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled'

/** A run as the add-in polls it. */
export interface WorkflowState {
  status: WorkflowStatus
  result?: unknown
  error?: string
}

/** Runs one named step once: on a replay its stored result is returned instead. */
export type Step = <T>(name: string, run: () => Promise<T>) => Promise<T>

/** A workflow body: plain code over its input, with each side effect in a step. */
export type WorkflowBody = (input: unknown, step: Step) => Promise<unknown>

/** Durable workflow runs: started now, executed in the background, polled by id. */
export interface WorkflowEngine {
  start(workflow: string, input: unknown): Promise<string>
  get(runId: string): Promise<WorkflowState | undefined>
  cancel(runId: string): Promise<void>
}
