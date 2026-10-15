import { describe, expect, it } from 'vitest'
import type { LlmPort, StructuredCallInput } from '../ports/llm'
import type { Step } from '../ports/workflow-engine'
import {
  INITIAL_STYLE_PROFILE,
  type DocumentContext,
  type ResolveDocumentInput
} from '../profile/document-context'
import { feedbackWorkflow } from './feedback-workflow'
import { DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS } from './prompts/document-feedback-agent.prompt'

/** A document key as the add-in generates it. */
const documentUuid = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'

/** Feedback on one suggestion, as the add-in sends it. */
const feedback = {
  category: 'gramatica',
  context: 'Ayer fuistes al mercado.',
  anchor: 'fuistes',
  suggestedText: 'fuiste',
  justification: 'Segunda persona del pretérito sin -s.',
  action: 'reject',
  severity: 'high',
  suggestionType: 'track-change',
  documentUuid
}

/** Runs the workflow with an inline step runner and a model that answers `answer`. */
function setup(answer: unknown = { status: 'ignored', decisionSummary: 'Nada que cambiar.' }) {
  const steps: string[] = []
  const step: Step = async (name, run) => {
    steps.push(name)
    return run()
  }
  const calls: StructuredCallInput<unknown>[] = []
  const structuredCall = async (input: StructuredCallInput<unknown>): Promise<unknown> => {
    calls.push(input)
    return input.schema.parse(answer)
  }
  const resolved: ResolveDocumentInput[] = []
  const profiles = new Map<string, string>()
  const documents = {
    resolve: (input: ResolveDocumentInput): DocumentContext => {
      resolved.push(input)
      return {
        documentKey: input.documentKey,
        title: null,
        genre: 'general',
        processingConfig: {},
        profileMarkdown: INITIAL_STYLE_PROFILE
      }
    },
    updateStyleProfile: (key: string, markdown: string) => void profiles.set(key, markdown)
  }
  const body = feedbackWorkflow({ llm: { structuredCall } as LlmPort, documents })
  return { run: (input: unknown) => body(input, step), steps, calls, resolved, profiles }
}

describe('feedbackWorkflow', () => {
  it('acknowledges feedback without a comment without asking the model', async () => {
    const { run, steps, calls, resolved } = setup()

    const result = await run(feedback)

    expect(steps).toEqual(['load-author-profile', 'process-feedback'])
    expect(result).toEqual({ received: true, receivedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) })
    expect(calls).toEqual([])
    expect(resolved).toEqual([{ documentKey: documentUuid }])
  })

  it('updates the profile when the feedback agent decides to', async () => {
    const { run, calls, profiles } = setup({
      status: 'updated',
      decisionSummary: 'El autor usa voseo.',
      profileMarkdown: '# Perfil con voseo'
    })

    await run({ ...feedback, comment: 'Uso voseo a propósito.' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.system).toBe(DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS)
    expect(calls[0]?.prompt).toContain('Uso voseo a propósito.')
    expect(calls[0]?.prompt).toContain('PATRONES VIVOS')
    expect(profiles.get(documentUuid)).toBe('# Perfil con voseo')
  })

  it('leaves the profile alone when the agent ignores the feedback', async () => {
    const { run, profiles } = setup()

    await expect(run({ ...feedback, comment: 'Gracias.' })).resolves.toMatchObject({ received: true })
    expect(profiles.size).toBe(0)
  })

  it('fails when the agent says updated but sends no profile', async () => {
    const { run, profiles } = setup({ status: 'updated', decisionSummary: 'Actualizado.' })

    await expect(run({ ...feedback, comment: 'Uso voseo.' })).rejects.toThrow(/without profile markdown/)
    expect(profiles.size).toBe(0)
  })

  it('rejects input the original schema rejects', async () => {
    const { run, steps } = setup()

    await expect(run({ ...feedback, action: 'maybe' })).rejects.toThrow(/action/)
    expect(steps).toEqual([])
  })
})
