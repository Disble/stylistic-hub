// Copied from dhub (src/main/domain, commit bd94206): the sign-in protocol Pi login flows need. Keep in sync.
/** Longest URL, in characters, that may be opened outside the app; the cap applies before and after normalizing. */
export const MAX_EXTERNAL_URL_CHARS = 2048

/** The normalized URL when `value` may be opened outside the app (absolute http or https, within the length cap), else `undefined`. */
export function safeExternalUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_EXTERNAL_URL_CHARS) return undefined
  try {
    const url = new URL(value)
    const web = url.protocol === 'http:' || url.protocol === 'https:'
    return web && url.href.length <= MAX_EXTERNAL_URL_CHARS ? url.href : undefined
  } catch {
    return undefined
  }
}
