// The server health check after a version switch (odd/tasks/update-engine.md S3, ADR D6): `/api/v1/status`
// must answer 200 within 30 s. The request and the clock are injected; health-request.ts makes the real call.

/** One status request: resolves the HTTP status code, rejects when the server cannot be reached. */
export type StatusRequest = () => Promise<number>

/**
 * Polls `request` every `intervalMs` until it answers 200 (healthy) or `timeoutMs` has passed (unhealthy). An
 * unhealthy verdict is logged with what the last request got, since nothing else records why a check failed.
 */
export async function waitUntilHealthy({
  request,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 1000,
  timeoutMs = 30_000,
  log = () => undefined
}: {
  request: StatusRequest
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  timeoutMs?: number
  log?: (reason: string) => void
}): Promise<boolean> {
  const deadline = now() + timeoutMs
  for (;;) {
    const last = await request().then(
      (code) => ({ code, failure: undefined }),
      (error: unknown) => ({ code: undefined, failure: String(error) })
    )
    if (last.code === 200) return true
    if (now() >= deadline) {
      const got = last.failure === undefined ? `got ${last.code}` : `failed: ${last.failure}`
      log(`no 200 within ${timeoutMs / 1000} s; the last request ${got}`)
      return false
    }
    await sleep(intervalMs)
  }
}
