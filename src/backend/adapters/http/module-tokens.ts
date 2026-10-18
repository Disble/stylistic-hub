import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** The API route groups a module can be granted, one per resource of API v1 (docs/api.md#scopes). */
export const API_SCOPES = ['status', 'documents', 'analyses', 'feedback', 'preferences', 'modules'] as const

/** One API route group. */
export type ApiScope = (typeof API_SCOPES)[number]

/**
 * A module's token: HMAC-SHA256 of `module:<id>` keyed by the hub token. The backend derives it from
 * the hub token it already has, so nothing new is stored or passed, and a new hub token renews it.
 */
export function moduleToken(hubToken: string, id: string): string {
  return createHmac('sha256', hubToken).update(`module:${id}`).digest('hex')
}

/**
 * The scope of an API path: its first segment under `/api/v1`, except that starting an analysis
 * (`/documents/{id}/analyses`) belongs to `analyses`. Undefined for a path in no scope
 * (`/openapi.json`), which only the hub token reaches.
 */
function scopeOf(path: string): ApiScope | undefined {
  const [, api, version, group, , child] = path.split('/')
  if (api !== 'api' || version !== 'v1') return undefined
  if (group === 'documents' && child === 'analyses') return 'analyses'
  return API_SCOPES.find((scope) => scope === group)
}

/** Compares two tokens in constant time, whatever their lengths. */
function sameToken(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(a), digest(b))
}

/**
 * Whether `sent` may call `path`: the hub token reaches every route, a module's token only the
 * scopes that module declared.
 */
export function tokenVerifier(
  hubToken: string,
  modules: readonly { id: string; scopes: readonly ApiScope[] }[]
): (sent: string, path: string) => boolean {
  const granted = modules.map(({ id, scopes }) => ({ token: moduleToken(hubToken, id), scopes }))
  return (sent, path) => {
    if (sameToken(sent, hubToken)) return true
    const scope = scopeOf(path)
    const module = granted.find(({ token }) => sameToken(sent, token))
    return module !== undefined && scope !== undefined && module.scopes.includes(scope)
  }
}
