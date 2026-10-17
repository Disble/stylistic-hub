import { describe, expect, it } from 'vitest'
import { messageOf } from './errors'

describe('messageOf', () => {
  it('gives an error its message and anything else its text', () => {
    expect(messageOf(new Error('The model request failed: 529'))).toBe('The model request failed: 529')
    expect(messageOf('socket hang up')).toBe('socket hang up')
  })
})
