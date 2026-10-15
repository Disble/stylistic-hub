import type { MiddlewareHandler } from 'hono'

/**
 * Rejects requests whose Host header is not one of ours. A DNS-rebinding page reaches
 * 127.0.0.1 under its own host name, so the peer check alone cannot stop it.
 * Custom code: Hono ships no Host-header guard (see docs/architecture.md).
 */
export function hostAllowlist(allowedHosts: readonly string[]): MiddlewareHandler {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()))
  return async (c, next) => {
    const host = c.req.header('host')?.toLowerCase()
    if (!host || !allowed.has(host)) return c.text('Forbidden host', 403)
    await next()
  }
}
