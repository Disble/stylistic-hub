import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAnalysisRepository } from '../adapters/sqlite/analysis-repository'
import { openDatabase } from '../adapters/sqlite/database'
import { SqliteDocumentRepository } from '../adapters/sqlite/document-repository'
import { SqliteFeedbackRepository } from '../adapters/sqlite/feedback-repository'
import type { LlmPort, StructuredCallInput } from '../ports/llm'
import { messageOf } from '../analysis/errors'
import type { WorkflowSuggestion } from '../analysis/schemas'
import type { Step, WorkflowBody } from '../ports/workflow-engine'
import { INITIAL_STYLE_PROFILE } from '../profile/document-context'
import { createProfileUpdater } from '../profile/profile-updater'
import {
  FEEDBACK_WORKFLOW,
  feedbackWorkflow,
  PROCESS_FEEDBACK_WORKFLOW,
  processFeedbackWorkflow
} from './feedback-workflow'
import { DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS } from './prompts/document-feedback-agent.prompt'

/** A document key as the add-in generates it. */
const DOC = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'

/** The suggestion the feedback is about, unless a test gives another. */
const FIX: WorkflowSuggestion = {
  type: 'track-change',
  context: 'Ayer fuistes al mercado.',
  anchor: 'fuistes',
  suggestedText: 'fuiste',
  justification: 'Segunda persona del pretérito sin -s.',
  category: 'gramatica',
  severity: 'high'
}

/** Fresh folder for each test's database file. */
let dir: string
/** This test's database. */
let db: DatabaseSync

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-feedback-wf-'))
  db = openDatabase(join(dir, 'stylistic.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * The feedback workflows over real repositories with one stored suggestion, an inline engine
 * (a child's throw becomes a failed result) and a model that answers `answer`, or throws it when
 * it is an Error.
 */
function setup(
  answer: unknown = { status: 'ignored', decisionSummary: 'Nada que cambiar.' },
  suggestion: WorkflowSuggestion = FIX
) {
  const documents = new SqliteDocumentRepository(db)
  documents.resolve({ documentKey: DOC })
  const analyses = new SqliteAnalysisRepository(db)
  analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })
  analyses.completePart('a1', '0', 0, [suggestion], 0)
  const suggestionId = analyses.get('a1')?.chunks[0]?.suggestions[0]?.id ?? ''
  const feedback = new SqliteFeedbackRepository(db)
  const steps: string[] = []
  const bodies: Record<string, WorkflowBody> = {}
  const step: Step = {
    run: async (name, fn) => {
      steps.push(name)
      return fn()
    },
    child: async (workflow, input, name) => {
      try {
        return { ok: true, value: (await bodies[workflow]?.(input, step, { id: name })) as never }
      } catch (error) {
        return { ok: false, error: messageOf(error) }
      }
    }
  }
  const calls: StructuredCallInput<unknown>[] = []
  const structuredCall = async (input: StructuredCallInput<unknown>): Promise<unknown> => {
    calls.push(input)
    if (answer instanceof Error) throw answer
    return input.schema.parse(answer)
  }
  const deps = {
    llm: { structuredCall } as LlmPort,
    analyses,
    feedback,
    profile: createProfileUpdater(documents)
  }
  bodies[FEEDBACK_WORKFLOW] = feedbackWorkflow(deps)
  bodies[PROCESS_FEEDBACK_WORKFLOW] = processFeedbackWorkflow(deps)
  /** Records feedback as the API does and runs its workflow. */
  const run = async (action: 'accept' | 'reject', comment?: string) => {
    feedback.create({ id: 'f1', suggestionId, action, ...(comment === undefined ? {} : { comment }) })
    await bodies[FEEDBACK_WORKFLOW]?.({ feedbackId: 'f1' }, step, { id: 'run' })
    return feedback.get('f1')
  }
  return { run, steps, calls, documents }
}

describe('feedbackWorkflow', () => {
  it('acknowledges feedback without a comment without asking the model', async () => {
    const { run, calls, steps } = setup()

    expect(await run('accept')).toMatchObject({ status: 'completed', outcome: 'acknowledged' })
    expect(calls).toEqual([])
    expect(steps).toEqual(['process-feedback'])
  })

  it('updates the profile from the stored suggestion when the agent decides to', async () => {
    const { run, calls, documents } = setup({
      status: 'updated',
      decisionSummary: 'El autor usa voseo.',
      profileMarkdown: '# Perfil con voseo'
    })

    expect(await run('reject', 'Uso voseo a propósito.')).toMatchObject({
      status: 'completed',
      outcome: 'updated',
      summary: 'El autor usa voseo.'
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.system).toBe(DOCUMENT_FEEDBACK_AGENT_INSTRUCTIONS)
    expect(calls[0]?.prompt).toContain('Uso voseo a propósito.')
    expect(calls[0]?.prompt).toContain('fuistes')
    expect(calls[0]?.prompt).toContain('PATRONES VIVOS')
    expect(documents.get(DOC)?.profileMarkdown).toBe('# Perfil con voseo')
  })

  it('describes a comment-only suggestion without suggested text', async () => {
    const note: WorkflowSuggestion = {
      type: 'comment-only',
      context: 'Ayer fuistes al mercado.',
      anchor: 'mercado',
      justification: 'Repetición.',
      category: 'estilo',
      severity: 'low'
    }
    const { run, calls } = setup(undefined, note)

    await run('reject', 'Es intencional.')

    expect(calls[0]?.prompt).toContain('Repetición.')
    expect(calls[0]?.prompt).not.toContain('"suggestedText"')
    expect(calls[0]?.prompt).toContain('"suggestionType": "comment-only"')
  })

  it('leaves the profile alone when the agent ignores the feedback', async () => {
    const { run, documents } = setup()

    expect(await run('accept', 'Gracias.')).toMatchObject({ status: 'completed', outcome: 'ignored' })
    expect(documents.get(DOC)?.profileMarkdown).toBe(INITIAL_STYLE_PROFILE)
  })

  it('fails with the reason when the agent says updated but sends no profile', async () => {
    const { run, documents } = setup({ status: 'updated', decisionSummary: 'Cambio.' })

    expect(await run('reject', 'Uso voseo.')).toMatchObject({
      status: 'failed',
      error: 'Document feedback agent returned an updated status without profile markdown.'
    })
    expect(documents.get(DOC)?.profileMarkdown).toBe(INITIAL_STYLE_PROFILE)
  })

  it('fails when its suggestion is gone', async () => {
    const { run } = setup()
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec('DELETE FROM suggestion')

    expect(await run('reject', 'Uso voseo.')).toMatchObject({
      status: 'failed',
      error: 'Feedback f1 or its suggestion is gone'
    })
  })

  it('fails with the provider message when the model call fails', async () => {
    const { run } = setup(new Error('The model request failed: 400 bad request'))

    expect(await run('reject', 'Uso voseo.')).toMatchObject({
      status: 'failed',
      error: 'The model request failed: 400 bad request'
    })
  })
})
