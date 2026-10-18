import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import type { StatusRequest } from './health-check'

/** A request that hangs longer than this counts as a failed attempt. */
const REQUEST_TIMEOUT_MS = 5000

/**
 * `GET https://localhost:<port><path>` (default `/api/v1/status`) with the hub token, the loopback Host the API requires and the
 * hub CA as the only trusted root. node:https, because global fetch takes no CA without a dispatcher package
 * and Electron's net.fetch trusts only Windows' store, which may not hold the hub CA yet.
 *
 * With `leafFile` the request runs in health-only pinned-leaf mode (docs/health-check-tls.md): it trusts
 * exactly the managed `localhost.pem` instead of the CA, because the hub runtime cannot verify the CA's
 * IP name constraints. The file is reread on every attempt, so a leaf renewal takes effect on the next
 * poll; a missing or unreadable leaf rejects the attempt, never falling back to the CA. Hostname and
 * expiry validation stay on in both modes.
 */
export function hubStatusRequest({
  port,
  token,
  caFile,
  leafFile,
  path = '/api/v1/status'
}: {
  port: number
  token: string
  caFile: string
  /** The managed leaf to pin for a health check; undefined keeps trusting the CA. */
  leafFile?: string | undefined
  /** Another path, such as a module's `/m/<id>/taskpane.html`. */
  path?: string
}): StatusRequest {
  return () =>
    new Promise((resolve, reject) => {
      const call = request(
        {
          host: 'localhost',
          port,
          path,
          method: 'GET',
          ca: readFileSync(leafFile ?? caFile),
          allowPartialTrustChain: leafFile !== undefined,
          rejectUnauthorized: true,
          headers: { authorization: `Bearer ${token}`, host: `localhost:${port}` },
          timeout: REQUEST_TIMEOUT_MS
        },
        (response) => {
          response.resume()
          resolve(response.statusCode ?? 0)
        }
      )
      call.on('timeout', () => call.destroy(new Error('timeout')))
      call.on('error', reject)
      call.end()
    })
}
