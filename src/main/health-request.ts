import { readFileSync } from 'node:fs'
import { request } from 'node:https'
import type { StatusRequest } from './health-check'

/** A request that hangs longer than this counts as a failed attempt. */
const REQUEST_TIMEOUT_MS = 5000

/**
 * `GET https://localhost:<port>/api/v1/status` with the hub token, the loopback Host the API requires and the
 * hub CA as the only trusted root. node:https, because global fetch takes no CA without a dispatcher package
 * and Electron's net.fetch trusts only Windows' store, which may not hold the hub CA yet.
 */
export function hubStatusRequest({
  port,
  token,
  caFile
}: {
  port: number
  token: string
  caFile: string
}): StatusRequest {
  return () =>
    new Promise((resolve, reject) => {
      const call = request(
        {
          host: 'localhost',
          port,
          path: '/api/v1/status',
          method: 'GET',
          ca: readFileSync(caFile),
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
