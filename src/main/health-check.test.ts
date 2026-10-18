import { describe, expect, it, vi } from 'vitest'
import { waitUntilHealthy } from './health-check'

/** A clock that only moves when the check sleeps. */
function fakeClock() {
  let time = 0
  return { now: () => time, sleep: vi.fn(async (ms: number) => void (time += ms)) }
}

describe('waitUntilHealthy', () => {
  it('is healthy on the first 200, polling every second until then', async () => {
    const clock = fakeClock()
    const request = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(503)
      .mockResolvedValueOnce(200)

    expect(await waitUntilHealthy({ request, ...clock })).toBe(true)
    expect(request).toHaveBeenCalledTimes(3)
    expect(clock.sleep.mock.calls).toEqual([[1000], [1000]])
  })

  it('is unhealthy when no 200 arrives within 30 s', async () => {
    const clock = fakeClock()
    const request = vi.fn(async () => 401)

    expect(await waitUntilHealthy({ request, ...clock })).toBe(false)
    expect(clock.now()).toBe(30_000)
    expect(request).toHaveBeenCalledTimes(31)
  })

  it('times out when every request fails to connect', async () => {
    const clock = fakeClock()
    const request = vi.fn(async () => Promise.reject(new Error('ECONNREFUSED')))

    expect(await waitUntilHealthy({ request, ...clock })).toBe(false)
    expect(clock.now()).toBe(30_000)
  })
  it('uses the real clock by default', async () => {
    const request = vi.fn(async () => 503)

    expect(await waitUntilHealthy({ request, intervalMs: 1, timeoutMs: 5 })).toBe(false)
    expect(request.mock.calls.length).toBeGreaterThan(1)
  })
})
