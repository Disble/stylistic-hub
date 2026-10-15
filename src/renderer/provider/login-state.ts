import type { LoginEvent, LoginNotice, LoginPrompt } from '../../shared/login/login'

/** What the sign-in dialog shows for one running or finished sign-in. */
export interface LoginState {
  loginId: string
  providerId: string
  providerName: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  /** Notices in arrival order; only the latest progress message is kept. */
  notices: LoginNotice[]
  /** The question the flow is waiting on, if any. */
  prompt?: { promptId: string; prompt: LoginPrompt }
  /** Why the sign-in failed. */
  error?: string
}

/** The state of a sign-in that was just started. */
export function loginStarted(loginId: string, providerId: string, providerName: string): LoginState {
  return { loginId, providerId, providerName, status: 'running', notices: [] }
}

/** Applies one login event; events of other sign-ins leave the state untouched. */
export function reduceLogin(state: LoginState, event: LoginEvent): LoginState {
  if (event.loginId !== state.loginId) return state
  const withoutPrompt: LoginState = { ...state }
  delete withoutPrompt.prompt
  switch (event.type) {
    case 'login-notice': {
      const kept =
        event.notice.type === 'progress' ? state.notices.filter((n) => n.type !== 'progress') : state.notices
      return { ...state, notices: [...kept, event.notice] }
    }
    case 'login-prompt':
      return { ...state, prompt: { promptId: event.promptId, prompt: event.prompt } }
    case 'login-prompt-closed':
      return state.prompt?.promptId === event.promptId ? withoutPrompt : state
    case 'login-done':
      return { ...withoutPrompt, status: 'done' }
    case 'login-failed':
      return event.cancelled
        ? { ...withoutPrompt, status: 'cancelled' }
        : { ...withoutPrompt, status: 'failed', error: event.message }
  }
}
