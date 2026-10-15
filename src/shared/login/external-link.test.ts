import { describe, expect, it } from 'vitest'
import { MAX_EXTERNAL_URL_CHARS, safeExternalUrl } from './external-link'

describe('safeExternalUrl length cap', () => {
  it('accepts a URL of exactly the cap and refuses one character more', () => {
    const base = 'https://example.com/'
    expect(safeExternalUrl(base + 'a'.repeat(MAX_EXTERNAL_URL_CHARS - base.length))).toBeDefined()
    expect(safeExternalUrl(base + 'a'.repeat(MAX_EXTERNAL_URL_CHARS - base.length + 1))).toBeUndefined()
  })

  it('refuses a URL whose normalized form passes the cap even though the input did not', () => {
    const accented = 'https://example.com/' + '\u00e9'.repeat(MAX_EXTERNAL_URL_CHARS / 4)
    expect(accented.length).toBeLessThan(MAX_EXTERNAL_URL_CHARS)
    expect(safeExternalUrl(accented)).toBeUndefined()
  })
})

describe('safeExternalUrl', () => {
  it('accepts absolute http and https URLs and returns them normalized', () => {
    expect(safeExternalUrl('https://example.com')).toBe('https://example.com/')
    expect(safeExternalUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
  })

  it('rejects every other scheme', () => {
    const others = [
      'file:///etc/hosts',
      'javascript:alert(1)',
      'data:text/html,x',
      'custom-app:/run',
      'ftp://x.test'
    ]
    for (const url of others) expect(safeExternalUrl(url)).toBeUndefined()
  })

  it('rejects relative URLs, junk and non-strings', () => {
    for (const value of ['/relative', 'example.com', '', 42, null, undefined, {}]) {
      expect(safeExternalUrl(value)).toBeUndefined()
    }
  })
})
