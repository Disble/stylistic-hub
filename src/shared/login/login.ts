// Copied from dhub (src/main/domain, commit bd94206): the sign-in protocol Pi login flows need. Keep in sync; dhub's `LoginPort` is left out.
import { safeExternalUrl } from './external-link'

/** The sign-in methods a provider can offer. */
export type LoginAuthType = 'api_key' | 'oauth'

/** One choice of a `select` prompt. */
export interface LoginPromptOption {
  id: string
  label: string
  description?: string
}

/** A question the provider's login flow asks the user. */
export type LoginPrompt =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | { type: 'select'; message: string; options: readonly LoginPromptOption[] }

/** Something the login flow tells the user; never carries a credential. */
export type LoginNotice =
  | { type: 'info'; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }
  | { type: 'progress'; message: string }

/** Every login event names its sign-in and provider, so a late one is easy to discard. */
export type LoginEvent = { loginId: string; providerId: string } & (
  | { type: 'login-notice'; notice: LoginNotice }
  | { type: 'login-prompt'; promptId: string; prompt: LoginPrompt }
  | { type: 'login-prompt-closed'; promptId: string }
  | { type: 'login-done' }
  | { type: 'login-failed'; message: string; cancelled: boolean }
)

/** The interaction a provider's login flow drives; a structural match for the SDK's. */
export interface LoginInteraction {
  /** Aborts the whole flow. */
  signal: AbortSignal
  /** Asks the user; rejects when the prompt is cancelled or aborted. */
  prompt(prompt: LoginPrompt & { signal?: AbortSignal }): Promise<string>
  notify(notice: LoginNotice): void
}

/** What the manager needs from its surroundings; all of it is injectable. */
export interface LoginManagerDeps {
  /** Runs one provider's login flow to completion. The credential never leaves the runner. */
  run(providerId: string, type: LoginAuthType, interaction: LoginInteraction): Promise<void>
  emit(event: LoginEvent): void
  /** Runs `fn` after `ms` milliseconds; returns a function that cancels it. */
  schedule(fn: () => void, ms: number): () => void
  newId(): string
  /** How long a sign-in may stay silent before it is abandoned. */
  staleMs: number
}

/** Starts and steers sign-ins; at most one is active per provider. */
export interface LoginManager {
  /** Starts a sign-in and returns its id; events follow through `emit`. */
  start(providerId: string, type: LoginAuthType): string
  /** Delivers the user's answer to an open prompt. */
  answerPrompt(loginId: string, promptId: string, value: string): void
  /** Rejects one open prompt, leaving the rest of the flow to decide what happens. */
  cancelPrompt(loginId: string, promptId: string): void
  /** Aborts the whole sign-in. */
  cancelLogin(loginId: string): void
}

/** Recognizes a login event among the agent's pushed events (the session events never start with `login-`). */
export function isLoginEvent(event: { type: string }): event is LoginEvent {
  return event.type.startsWith('login-')
}

/** The sign-in page to open in the system browser for this event, when it announces one and the link is http(s). */
export function authUrlToOpen(event: LoginEvent): string | undefined {
  return event.type === 'login-notice' && event.notice.type === 'auth_url'
    ? safeExternalUrl(event.notice.url)
    : undefined
}

/** `Omit` applied to each member of a union, so the members keep their own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** The part of a login event that varies; the manager adds the ids. */
type LoginEventBody = DistributiveOmit<LoginEvent, 'loginId' | 'providerId'>

/** A prompt waiting for an answer. */
interface Pending {
  prompt: LoginPrompt
  resolve(value: string): void
  reject(error: Error): void
  /** Stops listening to the SDK's per-prompt abort signal. */
  detach(): void
}

/** One sign-in that is still running. */
interface Session {
  loginId: string
  providerId: string
  controller: AbortController
  /** Open prompts by id. */
  pending: Map<string, Pending>
  /** Every secret the user typed in this sign-in, so it can be redacted from messages. */
  secrets: Set<string>
  nextPrompt: number
  cancelTimer(): void
  finished: boolean
  /** When true the outcome is not reported: the sign-in was replaced by a newer one. */
  silent: boolean
  /** Settles once the provider's flow has returned, whatever way it ended. */
  ended: Promise<void>
}

/** How long a new sign-in waits for the one it replaces to let go of what it holds, such as a local port. */
const REPLACE_WAIT_MS = 3000

/** How long a device code keeps a login alive beyond its own expiry. */
const DEVICE_CODE_GRACE_MS = 60_000

/** Copies a notice keeping only the known fields, so nothing extra reaches the UI. */
function cleanNotice(notice: LoginNotice, redact: (text: string) => string): LoginNotice {
  switch (notice.type) {
    case 'info':
      return {
        type: 'info',
        message: redact(notice.message),
        ...(notice.links === undefined
          ? {}
          : {
              links: notice.links.map((l) => ({
                url: l.url,
                ...(l.label === undefined ? {} : { label: l.label })
              }))
            })
      }
    case 'auth_url':
      return {
        type: 'auth_url',
        url: notice.url,
        ...(notice.instructions === undefined ? {} : { instructions: redact(notice.instructions) })
      }
    case 'device_code':
      return {
        type: 'device_code',
        userCode: notice.userCode,
        verificationUri: notice.verificationUri,
        ...(notice.intervalSeconds === undefined ? {} : { intervalSeconds: notice.intervalSeconds }),
        ...(notice.expiresInSeconds === undefined ? {} : { expiresInSeconds: notice.expiresInSeconds })
      }
    case 'progress':
      return { type: 'progress', message: redact(notice.message) }
  }
}

/** Copies a prompt keeping only the known fields. */
function cleanPrompt(prompt: LoginPrompt): LoginPrompt {
  if (prompt.type === 'select') {
    return {
      type: 'select',
      message: prompt.message,
      options: prompt.options.map((o) => ({
        id: o.id,
        label: o.label,
        ...(o.description === undefined ? {} : { description: o.description })
      }))
    }
  }
  return {
    type: prompt.type,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder })
  }
}

/** Correlates the user's answers with the flow's prompts and owns each sign-in's lifecycle. */
export function createLoginManager(deps: LoginManagerDeps): LoginManager {
  const byId = new Map<string, Session>()
  const byProvider = new Map<string, Session>()

  const emit = (session: Session, event: LoginEventBody): void => {
    if (session.silent) return
    deps.emit({ loginId: session.loginId, providerId: session.providerId, ...event } as LoginEvent)
  }

  const redactor =
    (session: Session) =>
    (text: string): string =>
      [...session.secrets].reduce((current, secret) => current.split(secret).join('[redacted]'), text)

  /** Ends a sign-in once: closes its prompts, frees the provider slot, reports the outcome. */
  const finish = (session: Session, outcome: LoginEventBody): void => {
    if (session.finished) return
    session.finished = true
    session.cancelTimer()
    byId.delete(session.loginId)
    byProvider.delete(session.providerId)
    for (const [promptId, pending] of session.pending) {
      pending.detach()
      emit(session, { type: 'login-prompt-closed', promptId })
      pending.reject(new Error('The sign-in ended'))
    }
    session.pending.clear()
    emit(session, outcome)
  }

  /** Ends a sign-in from our side and aborts the provider's flow. */
  const abandon = (session: Session, outcome: LoginEventBody): void => {
    finish(session, outcome)
    session.controller.abort(new Error('The sign-in was stopped'))
  }

  /** (Re)starts the silence timer; a live device code extends it to the code's own lifetime. */
  const touch = (session: Session, ms = deps.staleMs): void => {
    if (session.finished) return
    session.cancelTimer()
    session.cancelTimer = deps.schedule(() => {
      abandon(session, { type: 'login-failed', message: 'The sign-in timed out', cancelled: false })
    }, ms)
  }

  const closePrompt = (session: Session, promptId: string, error: Error): void => {
    const pending = session.pending.get(promptId)
    if (pending === undefined) return
    session.pending.delete(promptId)
    pending.detach()
    emit(session, { type: 'login-prompt-closed', promptId })
    pending.reject(error)
  }

  const interactionFor = (session: Session): LoginInteraction => ({
    signal: session.controller.signal,
    notify: (notice) => {
      if (session.finished) return
      const lifetime = notice.type === 'device_code' ? notice.expiresInSeconds : undefined
      touch(
        session,
        lifetime === undefined ? deps.staleMs : Math.max(deps.staleMs, lifetime * 1000 + DEVICE_CODE_GRACE_MS)
      )
      emit(session, { type: 'login-notice', notice: cleanNotice(notice, redactor(session)) })
    },
    prompt: (prompt) => {
      if (session.finished) return Promise.reject(new Error('The sign-in ended'))
      const { signal } = prompt
      if (signal?.aborted) return Promise.reject(new Error('The prompt was aborted'))
      const promptId = `p${++session.nextPrompt}`
      return new Promise<string>((resolve, reject) => {
        const onAbort = (): void => closePrompt(session, promptId, new Error('The prompt was aborted'))
        signal?.addEventListener('abort', onAbort, { once: true })
        const clean = cleanPrompt(prompt)
        session.pending.set(promptId, {
          prompt: clean,
          resolve,
          reject,
          detach: () => signal?.removeEventListener('abort', onAbort)
        })
        touch(session)
        emit(session, { type: 'login-prompt', promptId, prompt: clean })
      })
    }
  })

  const sessionOf = (loginId: string): Session => {
    const session = byId.get(loginId)
    if (session === undefined) throw new Error('That sign-in is not active')
    return session
  }

  return {
    start(providerId, type) {
      // One active login per provider: a new one replaces the old, which may be left behind by a
      // view that went away. The old one is aborted silently and the new flow waits for it to end.
      const previous = byProvider.get(providerId)
      if (previous !== undefined) {
        previous.silent = true
        abandon(previous, { type: 'login-failed', message: 'Replaced by a new sign-in', cancelled: true })
      }
      let markEnded = (): void => {}
      const session: Session = {
        loginId: deps.newId(),
        providerId,
        controller: new AbortController(),
        pending: new Map(),
        secrets: new Set(),
        nextPrompt: 0,
        cancelTimer: () => {},
        finished: false,
        silent: false,
        ended: new Promise<void>((resolve) => (markEnded = resolve))
      }
      byId.set(session.loginId, session)
      byProvider.set(providerId, session)
      touch(session)
      // Deferred so the caller has the id before the flow can emit anything, and, when it replaces
      // a login, until that one has ended (or the wait ran out).
      const ready =
        previous === undefined
          ? Promise.resolve()
          : Promise.race([
              previous.ended,
              new Promise<void>((resolve) => deps.schedule(resolve, REPLACE_WAIT_MS))
            ])
      void ready
        .then(() => deps.run(providerId, type, interactionFor(session)))
        .then(
          () => finish(session, { type: 'login-done' }),
          (error: unknown) =>
            finish(session, {
              type: 'login-failed',
              message: redactor(session)(error instanceof Error ? error.message : String(error)),
              cancelled: session.controller.signal.aborted
            })
        )
        .finally(markEnded)
      return session.loginId
    },

    answerPrompt(loginId, promptId, value) {
      const session = sessionOf(loginId)
      const pending = session.pending.get(promptId)
      if (pending === undefined) throw new Error('That prompt is no longer open')
      if (pending.prompt.type === 'select' && !pending.prompt.options.some((o) => o.id === value)) {
        throw new Error('The answer is not one of the choices')
      }
      if (pending.prompt.type === 'secret' && value !== '') session.secrets.add(value)
      session.pending.delete(promptId)
      pending.detach()
      touch(session)
      pending.resolve(value)
    },

    cancelPrompt(loginId, promptId) {
      closePrompt(sessionOf(loginId), promptId, new Error('The prompt was cancelled'))
    },

    cancelLogin(loginId) {
      const session = byId.get(loginId)
      if (session !== undefined) {
        abandon(session, { type: 'login-failed', message: 'Sign-in cancelled', cancelled: true })
      }
    }
  }
}
