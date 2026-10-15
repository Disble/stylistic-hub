import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Spinner,
  Text
} from '@fluentui/react-components'
import { useState, type FormEvent } from 'react'
import type { LoginNotice, LoginPrompt } from '../../shared/login/login'
import type { LoginState } from './login-state'

/** What the sign-in dialog needs. */
export interface LoginDialogProps {
  state: LoginState
  onAnswer(promptId: string, value: string): void
  onCancel(): void
  onClose(): void
}

/** One message from the provider's sign-in flow. */
function Notice({ notice }: { notice: LoginNotice }) {
  switch (notice.type) {
    case 'auth_url':
      return (
        <Text as="p" block>
          {notice.instructions ?? 'Finish signing in in your browser.'}{' '}
          <Link href={notice.url} target="_blank">
            Open the sign-in page
          </Link>
        </Text>
      )
    case 'device_code':
      return (
        <Text as="p" block>
          Enter this code on{' '}
          <Link href={notice.verificationUri} target="_blank">
            {notice.verificationUri}
          </Link>
          :{' '}
          <Text weight="semibold" font="monospace" size={500}>
            {notice.userCode}
          </Text>
        </Text>
      )
    case 'progress':
      return <Spinner size="tiny" label={notice.message} />
    case 'info':
      return (
        <Text as="p" block>
          {notice.message}
          {notice.links?.map((link) => (
            <span key={link.url}>
              {' '}
              <Link href={link.url} target="_blank">
                {link.label ?? link.url}
              </Link>
            </span>
          ))}
        </Text>
      )
  }
}

/** The question the flow is waiting on, answered with Continue. */
function PromptForm({
  promptId,
  prompt,
  onAnswer
}: {
  promptId: string
  prompt: LoginPrompt
  onAnswer: LoginDialogProps['onAnswer']
}) {
  const [value, setValue] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onAnswer(promptId, value)
  }
  return (
    <form onSubmit={submit}>
      {prompt.type === 'select' ? (
        <Field label={prompt.message}>
          <RadioGroup value={value} onChange={(_e, data) => setValue(data.value)}>
            {prompt.options.map((option) => (
              <Radio key={option.id} value={option.id} label={option.label} />
            ))}
          </RadioGroup>
        </Field>
      ) : (
        <Field label={prompt.message}>
          <Input
            type={prompt.type === 'secret' ? 'password' : 'text'}
            value={value}
            onChange={(_e, data) => setValue(data.value)}
            {...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder })}
          />
        </Field>
      )}
      <Button type="submit" appearance="primary" style={{ marginTop: 12 }}>
        Continue
      </Button>
    </form>
  )
}

/** Drives one Pi sign-in: shows its notices, asks its questions and reports how it ended. */
export function LoginDialog({ state, onAnswer, onCancel, onClose }: LoginDialogProps) {
  const running = state.status === 'running'
  return (
    <Dialog open modalType="modal">
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Sign in to {state.providerName}</DialogTitle>
          <DialogContent style={{ display: 'grid', gap: 12 }}>
            {state.notices.map((notice, index) => (
              <Notice key={index} notice={notice} />
            ))}
            {state.prompt && <PromptForm key={state.prompt.promptId} {...state.prompt} onAnswer={onAnswer} />}
            {state.error && (
              <MessageBar intent="error">
                <MessageBarBody>{state.error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            {running ? <Button onClick={onCancel}>Cancel</Button> : <Button onClick={onClose}>Close</Button>}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
