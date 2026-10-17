/** Where a run is. The hub's own tables say what it produced; the engine only executes. */
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled'

/** A run's status, and why it failed when it did. */
export interface RunState {
  status: RunStatus
  error?: string
}

/** How a child workflow ended: its output, or the message of the error it failed with. */
export type ChildResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Durable steps: on a replay each returns its stored result instead of running again. A body never
 * catches what `run` throws: the engine retries a failed step by replaying the run, and pauses a
 * run by throwing too. Work whose final failure the body must record runs as a child, whose failure
 * is final and comes back as a result.
 */
export interface Step {
  /** Runs one named side effect once, retried when it throws. */
  run<T>(name: string, fn: () => Promise<T>): Promise<T>
  /** Runs another workflow as a child and waits for how it ended; children may run in parallel. */
  child<T>(workflow: string, input: unknown, name: string): Promise<ChildResult<T>>
}

/** The run a body executes in. */
export interface RunInfo {
  id: string
}

/** A workflow body: plain code over its input, with each side effect in a step. */
export type WorkflowBody = (input: unknown, step: Step, run: RunInfo) => Promise<unknown>

/** Durable workflow runs: started now, executed in the background, resumed after a restart. */
export interface WorkflowEngine {
  start(workflow: string, input: unknown): Promise<string>
  get(runId: string): Promise<RunState | undefined>
  /** Cancels a run; a run that already finished stays as it is. */
  cancel(runId: string): Promise<void>
}
