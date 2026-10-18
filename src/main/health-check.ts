// The server health check after a version switch (odd/tasks/update-engine.md S3, ADR D6): `/api/v1/status`
// must answer 200 within 30 s. The request and the clock are injected; health-request.ts makes the real call.

/** One status request: resolves the HTTP status code, rejects when the server cannot be reached. */
export type StatusRequest = () => Promise<number>

/** Polls `request` every `intervalMs` until it answers 200 (healthy) or `timeoutMs` has passed (unhealthy). */
export async function waitUntilHealthy({
  request,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  intervalMs = 1000,
  timeoutMs = 30_000
}: {
  request: StatusRequest
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  intervalMs?: number
  timeoutMs?: number
}): Promise<boolean> {
  const deadline = now() + timeoutMs
  for (;;) {
    const code = await request().catch(() => undefined)
    if (code === 200) return true
    if (now() >= deadline) return false
    await sleep(intervalMs)
  }
}
