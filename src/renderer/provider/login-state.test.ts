import { describe, expect, it } from 'vitest'
import type { LoginEvent } from '../../shared/login/login'
import { loginStarted, reduceLogin, type LoginState } from './login-state'

/** A sign-in that just started. */
const started: LoginState = loginStarted('l1', 'openai', 'OpenAI')

/** Builds an event of the sign-in under test. */
function event(body: object): LoginEvent {
  return { loginId: 'l1', providerId: 'openai', ...body } as LoginEvent
}

describe('reduceLogin', () => {
  it('starts in progress with nothing to show', () => {
    expect(started).toEqual({
      loginId: 'l1',
      providerId: 'openai',
      providerName: 'OpenAI',
      status: 'running',
      notices: []
    })
  })

  it('keeps notices in order and replaces an older progress message', () => {
    let state = reduceLogin(
      started,
      event({ type: 'login-notice', notice: { type: 'progress', message: 'Waiting' } })
    )
    state = reduceLogin(
      state,
      event({ type: 'login-notice', notice: { type: 'auth_url', url: 'https://x.test' } })
    )
    state = reduceLogin(
      state,
      event({ type: 'login-notice', notice: { type: 'progress', message: 'Exchanging' } })
    )

    expect(state.notices).toEqual([
      { type: 'auth_url', url: 'https://x.test' },
      { type: 'progress', message: 'Exchanging' }
    ])
  })

  it('shows a prompt until it is closed', () => {
    const prompt = { type: 'secret', message: 'API key' }
    const open = reduceLogin(started, event({ type: 'login-prompt', promptId: 'p1', prompt }))
    const closed = reduceLogin(open, event({ type: 'login-prompt-closed', promptId: 'p1' }))

    expect(open.prompt).toEqual({ promptId: 'p1', prompt })
    expect(closed.prompt).toBeUndefined()
  })

  it('ignores the close of a prompt that is not the current one', () => {
    const open = reduceLogin(
      started,
      event({ type: 'login-prompt', promptId: 'p2', prompt: { type: 'text', message: 'x' } })
    )

    expect(reduceLogin(open, event({ type: 'login-prompt-closed', promptId: 'p1' })).prompt?.promptId).toBe(
      'p2'
    )
  })

  it('ends as done or failed, keeping the failure message', () => {
    expect(reduceLogin(started, event({ type: 'login-done' })).status).toBe('done')

    const failed = reduceLogin(started, event({ type: 'login-failed', message: 'Bad key', cancelled: false }))
    expect(failed).toMatchObject({ status: 'failed', error: 'Bad key' })
    expect(failed.prompt).toBeUndefined()
  })

  it('ends as cancelled without an error when the user stopped it', () => {
    const cancelled = reduceLogin(
      started,
      event({ type: 'login-failed', message: 'Sign-in cancelled', cancelled: true })
    )

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.error).toBeUndefined()
  })

  it('ignores events of another sign-in', () => {
    const other = { loginId: 'l2', providerId: 'openai', type: 'login-done' } as LoginEvent

    expect(reduceLogin(started, other)).toBe(started)
  })
})
