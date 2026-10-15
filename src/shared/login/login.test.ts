import { describe, expect, it } from 'vitest'
import {
  authUrlToOpen,
  createLoginManager,
  isLoginEvent,
  type LoginAuthType,
  type LoginEvent,
  type LoginInteraction,
  type LoginManager
} from './login'

/** Lets pending promise callbacks run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Fake secrets that must never show up in an event. */
const SECRET_KEY = 'FAKE-SECRET-KEY-9001'
/** A fake secret that only appears as an unknown field of a notice. */
const SECRET_TOKEN = 'FAKE-SECRET-TOKEN-9002'

/** The event of a prompt, narrowed. */
type PromptEvent = Extract<LoginEvent, { type: 'login-prompt' }>

/** A manager plus the handles a test needs to script the provider's side. */
interface Harness {
  manager: LoginManager
  events: LoginEvent[]
  /** The interaction of the latest login flow, for scripting what the provider does. */
  interaction(): LoginInteraction
  /** Ends the latest login flow like the SDK would. */
  finish(): void
  fail(error: Error): void
  /** Makes the flow started `index`-th (from zero) fail, like the SDK does when it is aborted. */
  failAt(index: number, error: Error): void
  interactionAt(index: number): LoginInteraction
  timers: { ms: number; fn: () => void; cancelled: boolean }[]
  runs: { providerId: string; type: LoginAuthType }[]
}

/** A manager over a scripted runner and a fake scheduler; no real provider, no clock. */
function harness(staleMs = 1000): Harness {
  const events: LoginEvent[] = []
  const timers: Harness['timers'] = []
  const runs: Harness['runs'] = []
  const interactions: LoginInteraction[] = []
  const settle: { resolve(): void; reject(error: Error): void }[] = []
  let id = 0
  const manager = createLoginManager({
    run: (providerId, type, interaction) => {
      runs.push({ providerId, type })
      interactions.push(interaction)
      return new Promise<void>((resolve, reject) => settle.push({ resolve, reject }))
    },
    emit: (event) => events.push(event),
    schedule: (fn, ms) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    newId: () => `login-${++id}`,
    staleMs
  })
  const last = <T>(list: T[]): T => list[list.length - 1] as T
  return {
    manager,
    events,
    timers,
    runs,
    interaction: () => last(interactions),
    finish: () => last(settle).resolve(),
    fail: (error) => last(settle).reject(error),
    failAt: (index, error) => (settle[index] as (typeof settle)[number]).reject(error),
    interactionAt: (index) => interactions[index] as LoginInteraction
  }
}

/** The prompt events among the events, in order. */
const prompts = (events: LoginEvent[]): PromptEvent[] =>
  events.filter((e): e is PromptEvent => e.type === 'login-prompt')

/** The event types among the events, in order. */
const types = (events: LoginEvent[]): string[] => events.map((e) => e.type)

describe('isLoginEvent', () => {
  it('tells login events from session events', () => {
    expect(isLoginEvent({ type: 'login-notice' })).toBe(true)
    expect(isLoginEvent({ type: 'login-done' })).toBe(true)
    expect(isLoginEvent({ type: 'text-delta' })).toBe(false)
    expect(isLoginEvent({ type: 'settled' })).toBe(false)
  })
})

describe('authUrlToOpen', () => {
  const notice = (url: string): LoginEvent => ({
    type: 'login-notice',
    loginId: 'l',
    providerId: 'anthropic',
    notice: { type: 'auth_url', url }
  })

  it('returns the sign-in page of an auth_url notice when it is an http(s) link', () => {
    expect(authUrlToOpen(notice('https://example.com/authorize?state=abc'))).toBe(
      'https://example.com/authorize?state=abc'
    )
    expect(authUrlToOpen(notice('http://localhost:1455/auth'))).toBe('http://localhost:1455/auth')
  })

  it('refuses every other scheme and every other event', () => {
    expect(authUrlToOpen(notice('javascript:alert(1)'))).toBeUndefined()
    expect(authUrlToOpen(notice('file:///C:/Windows/System32/calc.exe'))).toBeUndefined()
    expect(authUrlToOpen(notice('not a url'))).toBeUndefined()
    const other: LoginEvent = {
      type: 'login-notice',
      loginId: 'l',
      providerId: 'p',
      notice: { type: 'info', message: 'https://example.com' }
    }
    expect(authUrlToOpen(other)).toBeUndefined()
    expect(authUrlToOpen({ type: 'login-done', loginId: 'l', providerId: 'p' })).toBeUndefined()
  })
})

describe('login manager', () => {
  it('starts the provider flow and returns the login id', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    expect(loginId).toBe('login-1')
    expect(h.runs).toEqual([{ providerId: 'anthropic', type: 'oauth' }])
  })

  it('relays notices as events for that login', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    h.interaction().notify({
      type: 'auth_url',
      url: 'https://example.com/authorize',
      instructions: 'Sign in'
    })
    h.interaction().notify({ type: 'progress', message: 'Waiting' })
    expect(h.events).toEqual([
      {
        type: 'login-notice',
        loginId,
        providerId: 'anthropic',
        notice: { type: 'auth_url', url: 'https://example.com/authorize', instructions: 'Sign in' }
      },
      {
        type: 'login-notice',
        loginId,
        providerId: 'anthropic',
        notice: { type: 'progress', message: 'Waiting' }
      }
    ])
  })

  it('emits a prompt with an id and resolves it when the user answers', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const answer = h.interaction().prompt({ type: 'manual_code', message: 'Paste the code' })
    const [event] = prompts(h.events)
    expect(event?.prompt).toEqual({ type: 'manual_code', message: 'Paste the code' })
    h.manager.answerPrompt(loginId, event?.promptId as string, 'the-code')
    await expect(answer).resolves.toBe('the-code')
  })

  it('gives every prompt its own id, even with two open at once', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const first = h.interaction().prompt({ type: 'text', message: 'A' })
    const second = h.interaction().prompt({ type: 'text', message: 'B' })
    const [a, b] = prompts(h.events)
    expect(a?.promptId).not.toBe(b?.promptId)
    h.manager.answerPrompt(loginId, b?.promptId as string, 'second')
    h.manager.answerPrompt(loginId, a?.promptId as string, 'first')
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
  })

  it('rejects an answer for an unknown login, an unknown prompt or a prompt that already closed', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    void h.interaction().prompt({ type: 'text', message: 'A' })
    const promptId = prompts(h.events)[0]?.promptId as string
    expect(() => h.manager.answerPrompt('nope', promptId, 'x')).toThrow('not active')
    expect(() => h.manager.answerPrompt(loginId, 'nope', 'x')).toThrow('no longer open')
    h.manager.answerPrompt(loginId, promptId, 'x')
    expect(() => h.manager.answerPrompt(loginId, promptId, 'x')).toThrow('no longer open')
  })

  it('only accepts one of the offered choices for a select prompt', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const answer = h.interaction().prompt({
      type: 'select',
      message: 'Region',
      options: [
        { id: 'us', label: 'US' },
        { id: 'eu', label: 'EU', description: 'Europe' }
      ]
    })
    const promptId = prompts(h.events)[0]?.promptId as string
    expect(() => h.manager.answerPrompt(loginId, promptId, 'asia')).toThrow('not one of the choices')
    h.manager.answerPrompt(loginId, promptId, 'eu')
    await expect(answer).resolves.toBe('eu')
  })

  it('rejects one prompt when the user cancels it and tells the UI it closed', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const answer = h.interaction().prompt({ type: 'manual_code', message: 'Paste' })
    const promptId = prompts(h.events)[0]?.promptId as string
    h.manager.cancelPrompt(loginId, promptId)
    await expect(answer).rejects.toThrow('cancelled')
    expect(h.events.slice(1)).toEqual([
      { type: 'login-prompt-closed', loginId, providerId: 'anthropic', promptId }
    ])
  })

  it('closes a prompt the SDK aborts, for example when the local callback server wins', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const controller = new AbortController()
    const answer = h
      .interaction()
      .prompt({ type: 'manual_code', message: 'Paste', signal: controller.signal })
    const promptId = prompts(h.events)[0]?.promptId as string
    controller.abort()
    await expect(answer).rejects.toThrow()
    expect(h.events.slice(1)).toEqual([
      { type: 'login-prompt-closed', loginId, providerId: 'anthropic', promptId }
    ])
    // A late answer for the closed prompt is refused.
    expect(() => h.manager.answerPrompt(loginId, promptId, 'late')).toThrow('no longer open')
  })

  it('rejects at once a prompt whose signal was already aborted, without showing it', async () => {
    const h = harness()
    h.manager.start('anthropic', 'oauth')
    await flush()
    const controller = new AbortController()
    controller.abort()
    await expect(
      h.interaction().prompt({ type: 'text', message: 'x', signal: controller.signal })
    ).rejects.toThrow()
    expect(h.events).toEqual([])
  })

  it('reports success and closes a prompt that is still open when the flow finishes', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const settled = h
      .interaction()
      .prompt({ type: 'manual_code', message: 'Paste' })
      .catch((e: Error) => e.message)
    h.finish()
    await flush()
    expect(types(h.events)).toEqual(['login-prompt', 'login-prompt-closed', 'login-done'])
    expect(h.events[2]).toEqual({ type: 'login-done', loginId, providerId: 'anthropic' })
    expect(await settled).toBeTruthy()
  })

  it('reports a failure with its message', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    h.fail(new Error('The provider said no'))
    await flush()
    expect(h.events).toEqual([
      {
        type: 'login-failed',
        loginId,
        providerId: 'anthropic',
        message: 'The provider said no',
        cancelled: false
      }
    ])
  })

  it('cancels the whole login: aborts the flow, closes prompts, reports a cancellation once', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const answer = h
      .interaction()
      .prompt({ type: 'manual_code', message: 'Paste' })
      .catch(() => 'rejected')
    h.manager.cancelLogin(loginId)
    expect(h.interaction().signal.aborted).toBe(true)
    expect(await answer).toBe('rejected')
    h.fail(new Error('aborted by the SDK'))
    await flush()
    expect(types(h.events)).toEqual(['login-prompt', 'login-prompt-closed', 'login-failed'])
    expect(h.events[2]).toMatchObject({ cancelled: true })
  })

  it('ignores events from a flow that already ended', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    h.finish()
    await flush()
    h.interaction().notify({ type: 'progress', message: 'late' })
    await expect(h.interaction().prompt({ type: 'text', message: 'late' })).rejects.toThrow()
    expect(types(h.events)).toEqual(['login-done'])
    expect(() => h.manager.cancelLogin(loginId)).not.toThrow()
  })

  it('keeps one active login per provider by replacing the earlier one, silently, once it has ended', async () => {
    const h = harness()
    const first = h.manager.start('anthropic', 'oauth')
    await flush()
    const second = h.manager.start('anthropic', 'api_key')
    expect(second).not.toBe(first)
    expect(h.interactionAt(0).signal.aborted).toBe(true)
    // The new flow waits for the old one to end, so a port or a server it held is free again.
    await flush()
    expect(h.runs).toHaveLength(1)
    h.failAt(0, new Error('aborted by the SDK'))
    await flush()
    expect(h.runs).toEqual([
      { providerId: 'anthropic', type: 'oauth' },
      { providerId: 'anthropic', type: 'api_key' }
    ])
    // Nothing was reported for the replaced login, and its late calls do nothing.
    h.interactionAt(0).notify({ type: 'progress', message: 'late' })
    expect(h.events).toEqual([])
    expect(() => h.manager.cancelLogin(first)).not.toThrow()
    h.interactionAt(1).notify({ type: 'progress', message: 'new' })
    expect(h.events).toMatchObject([{ loginId: second, type: 'login-notice' }])
  })

  it('does not wait for ever for a replaced flow that ignores the abort', async () => {
    const h = harness()
    h.manager.start('anthropic', 'oauth')
    await flush()
    h.manager.start('anthropic', 'oauth')
    await flush()
    expect(h.runs).toHaveLength(1)
    const grace = h.timers.filter((t) => !t.cancelled && t.ms < 5000).pop()
    expect(grace?.ms).toBe(3000)
    grace?.fn()
    await flush()
    expect(h.runs).toHaveLength(2)
  })

  it('runs the logins of different providers side by side', async () => {
    const h = harness()
    h.manager.start('anthropic', 'oauth')
    h.manager.start('openai', 'api_key')
    await flush()
    expect(h.runs.map((r) => r.providerId)).toEqual(['anthropic', 'openai'])
    expect(h.interactionAt(0).signal.aborted).toBe(false)
  })

  it('frees the provider slot when the flow finishes on its own', async () => {
    const h = harness()
    h.manager.start('anthropic', 'oauth')
    await flush()
    h.finish()
    await flush()
    expect(() => h.manager.start('anthropic', 'oauth')).not.toThrow()
  })

  it('abandons a stale login after the silence limit and reports a timeout', async () => {
    const h = harness(5000)
    const loginId = h.manager.start('anthropic', 'oauth')
    await flush()
    const timer = h.timers[h.timers.length - 1]
    expect(timer?.ms).toBe(5000)
    timer?.fn()
    await flush()
    expect(h.interaction().signal.aborted).toBe(true)
    expect(h.events).toEqual([
      {
        type: 'login-failed',
        loginId,
        providerId: 'anthropic',
        message: 'The sign-in timed out',
        cancelled: false
      }
    ])
  })

  it('restarts the silence timer on activity and stops it when the login ends', async () => {
    const h = harness(5000)
    h.manager.start('anthropic', 'oauth')
    await flush()
    const before = h.timers.length
    h.interaction().notify({ type: 'progress', message: 'still here' })
    expect(h.timers.length).toBe(before + 1)
    expect(h.timers[before - 1]?.cancelled).toBe(true)
    h.finish()
    await flush()
    expect(h.timers[h.timers.length - 1]?.cancelled).toBe(true)
  })

  it('waits for as long as a device code lives before calling the login stale', async () => {
    const h = harness(5000)
    h.manager.start('github-copilot', 'oauth')
    await flush()
    h.interaction().notify({
      type: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.com/device',
      intervalSeconds: 5,
      expiresInSeconds: 900
    })
    expect(h.timers[h.timers.length - 1]?.ms).toBe(900_000 + 60_000)
  })

  it('never lets an answer or an unknown field of a notice reach an event', async () => {
    const h = harness()
    const loginId = h.manager.start('anthropic', 'api_key')
    await flush()
    const key = h.interaction().prompt({ type: 'secret', message: 'API key', placeholder: 'sk-...' })
    h.manager.answerPrompt(loginId, prompts(h.events)[0]?.promptId as string, SECRET_KEY)
    await key
    // The SDK's notices may carry extra fields; only the known ones are relayed.
    h.interaction().notify({
      type: 'info',
      message: `Using ${SECRET_KEY}`,
      extra: SECRET_TOKEN
    } as unknown as Parameters<LoginInteraction['notify']>[0])
    h.fail(new Error(`Rejected key ${SECRET_KEY}`))
    await flush()
    const text = JSON.stringify(h.events)
    expect(text).not.toContain(SECRET_KEY)
    expect(text).not.toContain(SECRET_TOKEN)
    expect(text).toContain('[redacted]')
  })

  it('does not relay the credential the flow produced', async () => {
    const events: LoginEvent[] = []
    const manager = createLoginManager({
      // A runner that produced a credential still resolves to nothing: it never leaves the runner.
      run: () => Promise.resolve(),
      emit: (event) => events.push(event),
      schedule: () => () => {},
      newId: () => 'l1',
      staleMs: 1000
    })
    manager.start('anthropic', 'oauth')
    await flush()
    expect(events).toEqual([{ type: 'login-done', loginId: 'l1', providerId: 'anthropic' }])
  })
})
