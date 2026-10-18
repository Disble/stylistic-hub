import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAnalysisService, type ChosenModel } from '../../analysis/analysis-service'
import {
  ANALYSIS_WORKFLOW,
  analysisWorkflow,
  analyzePartWorkflow,
  PART_WORKFLOW,
  PROFILE_WORKFLOW,
  updateProfileWorkflow
} from '../../analysis/analysis-workflow'
import { updateDocumentStyleProfileResultSchema } from '../../analysis/schemas'
import { createFeedbackService } from '../../feedback/feedback-service'
import {
  FEEDBACK_WORKFLOW,
  feedbackWorkflow,
  PROCESS_FEEDBACK_WORKFLOW,
  processFeedbackWorkflow
} from '../../feedback/feedback-workflow'
import { processFeedbackResultSchema } from '../../feedback/schemas'
import type { LlmPort, StructuredCallInput } from '../../ports/llm'
import { createProfileUpdater } from '../../profile/profile-updater'
import { createOpenWorkflowEngine } from '../openworkflow/engine'
import { SqliteAnalysisRepository } from '../sqlite/analysis-repository'
import { openDatabase } from '../sqlite/database'
import { SqliteDocumentRepository } from '../sqlite/document-repository'
import { SqliteFeedbackRepository } from '../sqlite/feedback-repository'
import { SqlitePreferencesRepository } from '../sqlite/preferences-repository'
import { apiV1 } from './api-v1'

/** A document id as the add-in stores it. */
const DOC = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'
/** The model chosen on the Provider screen. */
const FLASH: ChosenModel = { provider: 'opencode-go', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' }

/** Fresh folder for each test's databases. */
let dir: string
/** This test's hub database. */
let db: DatabaseSync
/** Stops this test's engine. */
let stop: () => Promise<void>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-api-v1-'))
  db = openDatabase(join(dir, 'stylistic.db'))
})

afterEach(async () => {
  await stop()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * The API over the real services, repositories and OpenWorkflow engine; only the model is fake.
 * A prompt containing `fail` makes the model fail as a provider does.
 */
async function setup({ model = FLASH, fail }: { model?: ChosenModel | null; fail?: string } = {}) {
  const documents = new SqliteDocumentRepository(db)
  const analyses = new SqliteAnalysisRepository(db)
  const feedback = new SqliteFeedbackRepository(db)
  const profile = createProfileUpdater(documents)
  const structuredCall = async (input: StructuredCallInput<unknown>): Promise<unknown> => {
    if (fail && input.prompt.includes(fail))
      throw new Error('The model request failed: 400 {"type":"MissingSessionID"}')
    if (input.schema === updateDocumentStyleProfileResultSchema) {
      return { profileMarkdown: '# Perfil actualizado', changeSummary: 'Añadido un patrón.' }
    }
    if (input.schema === processFeedbackResultSchema) {
      return {
        status: 'updated',
        decisionSummary: 'El autor usa voseo.',
        profileMarkdown: '# Perfil con voseo'
      }
    }
    return input.schema.parse({
      suggestions: [
        {
          type: 'track-change',
          context: 'ni persona mayores que',
          anchor: 'persona mayores',
          suggestedText: 'personas mayores',
          justification: 'Concordancia de número.',
          category: 'gramatica',
          severity: 'high'
        }
      ],
      cleanPatterns: []
    })
  }
  const llm = { structuredCall } as LlmPort
  const deps = { llm, documents, analyses, profile, correctionInstructions: async () => undefined }
  const feedbackDeps = { llm, analyses, feedback, profile }
  const engine = await createOpenWorkflowEngine({
    file: join(dir, 'workflows.db'),
    stepAttempts: 1,
    workflows: {
      [ANALYSIS_WORKFLOW]: analysisWorkflow(deps),
      [PART_WORKFLOW]: analyzePartWorkflow(deps),
      [PROFILE_WORKFLOW]: updateProfileWorkflow(deps),
      [FEEDBACK_WORKFLOW]: feedbackWorkflow(feedbackDeps),
      [PROCESS_FEEDBACK_WORKFLOW]: processFeedbackWorkflow(feedbackDeps)
    }
  })
  stop = () => engine.stop()
  const api = apiV1({
    serverVersion: '0.0.1',
    analyses: createAnalysisService({ documents, analyses, engine, model: async () => model ?? undefined }),
    feedback: createFeedbackService({ analyses, feedback, engine }),
    documents,
    preferences: new SqlitePreferencesRepository(db),
    modules: [{ id: 'stylistic-addon', version: '1.2.3.0' }]
  })
  /** Sends a request with a JSON body. */
  const send = (method: string, path: string, body?: unknown) =>
    api.request(path, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    })
  /** Polls a resource until its status leaves `running` or `pending`. */
  const settle = async (path: string) => {
    for (let i = 0; i < 300; i += 1) {
      const body = (await (await send('GET', path)).json()) as { status: string }
      if (body.status !== 'running' && body.status !== 'pending') return body as Record<string, unknown>
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`${path} did not settle`)
  }
  return { send, settle }
}

/** One chunk of the user's novel. */
const CHUNK = { id: '0', text: 'Huérfana, sin techo, ni persona mayores que cuidaran de ella.' }

describe('API v1', { timeout: 30_000 }, () => {
  it('says the hub can analyze, with the chosen model', async () => {
    const { send } = await setup()

    const response = await send('GET', '/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ version: '0.0.1', analysis: { ready: true, model: FLASH } })
  })

  it('lists the modules it serves with their versions', async () => {
    const { send } = await setup()

    const response = await send('GET', '/modules')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ modules: [{ id: 'stylistic-addon', version: '1.2.3.0' }] })
  })

  it('says why the hub cannot analyze without a model', async () => {
    const { send } = await setup({ model: null })

    expect(await (await send('GET', '/status')).json()).toEqual({
      version: '0.0.1',
      analysis: { ready: false, reason: 'Choose an AI provider and a model in the Stylistic Hub first.' }
    })
  })

  it('analyzes a document: 202, then the suggestions under hub ids and the profile updated once', async () => {
    const { send, settle } = await setup()

    const started = await send('POST', `/documents/${DOC}/analyses`, {
      genre: 'narrativa-literaria',
      chunks: [CHUNK]
    })
    expect(started.status).toBe(202)
    const { id, status } = (await started.json()) as { id: string; status: string }
    expect(status).toBe('running')

    const analysis = await settle(`/analyses/${id}`)

    expect(analysis).toMatchObject({ id, documentId: DOC, status: 'completed', profile: 'updated' })
    const [chunk] = analysis['chunks'] as {
      id: string
      status: string
      dropped: number
      suggestions: { id: string }[]
    }[]
    expect(chunk).toMatchObject({ id: '0', status: 'completed', dropped: 0 })
    expect(chunk?.suggestions).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{16}$/),
        type: 'track-change',
        context: 'ni persona mayores que',
        anchor: 'persona mayores',
        suggestedText: 'personas mayores',
        justification: 'Concordancia de número.',
        category: 'gramatica',
        severity: 'high'
      }
    ])
    const document = await (await send('GET', `/documents/${DOC}`)).json()
    expect(document).toEqual({
      id: DOC,
      genre: 'narrativa-literaria',
      profile: { markdown: '# Perfil actualizado', updatedAt: expect.stringMatching(/^\d{4}-/) }
    })
  })

  it('reports a provider failure on its chunk, with the provider message', async () => {
    const { send, settle } = await setup({ fail: 'Huérfana' })

    const { id } = (await (
      await send('POST', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [CHUNK] })
    ).json()) as {
      id: string
    }
    const analysis = await settle(`/analyses/${id}`)

    expect(analysis).toMatchObject({ status: 'failed', profile: 'unchanged' })
    expect((analysis['chunks'] as { error: string }[])[0]?.error).toBe(
      'The model request failed: 400 {"type":"MissingSessionID"}'
    )
  })

  it('refuses to analyze without a model, with a no_model problem', async () => {
    const { send } = await setup({ model: null })

    const response = await send('POST', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [CHUNK] })

    expect(response.status).toBe(409)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toEqual({
      type: 'urn:stylistic:problem:no_model',
      title: 'No AI model is chosen',
      status: 409,
      detail: 'Choose an AI provider and a model in the Stylistic Hub first.',
      code: 'no_model'
    })
  })

  it.each([
    [
      'a document id that is not a UUID',
      '/documents/not-a-uuid/analyses',
      { genre: 'general', chunks: [CHUNK] }
    ],
    ['an unknown genre', `/documents/${DOC}/analyses`, { genre: 'poesia', chunks: [CHUNK] }],
    ['no chunks', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [] }],
    ['repeated chunk ids', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [CHUNK, CHUNK] }],
    ['an unknown field', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [CHUNK], title: 'x' }],
    [
      'an unknown chunk field',
      `/documents/${DOC}/analyses`,
      { genre: 'general', chunks: [{ ...CHUNK, index: 0 }] }
    ],
    [
      'the old Mastra body',
      `/documents/${DOC}/analyses`,
      { inputData: { text: 'Texto.', documentUuid: DOC } }
    ]
  ])('answers %s with a validation_failed problem', async (_case, path, body) => {
    const { send } = await setup()

    const response = await send('POST', path, body)

    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toMatchObject({
      code: 'validation_failed',
      status: 400,
      detail: expect.any(String)
    })
  })

  it('cancels an analysis', async () => {
    const { send } = await setup()
    const { id } = (await (
      await send('POST', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [CHUNK] })
    ).json()) as {
      id: string
    }

    const response = await send('POST', `/analyses/${id}/cancel`)

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id,
      status: expect.stringMatching(/^(canceled|completed)$/)
    })
  })

  it('answers an unknown analysis, document or feedback with a not_found problem', async () => {
    const { send } = await setup()
    const unknown = '00000000-0000-4000-8000-000000000000'

    for (const path of [`/analyses/${unknown}`, `/documents/${unknown}`, `/feedback/${unknown}`]) {
      const response = await send('GET', path)
      expect(response.status).toBe(404)
      expect(await response.json()).toMatchObject({ code: 'not_found' })
    }
    expect((await send('POST', `/analyses/${unknown}/cancel`)).status).toBe(404)
  })

  it('learns from feedback on a suggestion, by its id', async () => {
    const { send, settle } = await setup()
    const { id } = (await (
      await send('POST', `/documents/${DOC}/analyses`, { genre: 'general', chunks: [CHUNK] })
    ).json()) as {
      id: string
    }
    const analysis = await settle(`/analyses/${id}`)
    const suggestionId = (analysis['chunks'] as { suggestions: { id: string }[] }[])[0]?.suggestions[0]?.id

    const submitted = await send('POST', '/feedback', {
      suggestionId,
      action: 'reject',
      comment: 'Uso voseo a propósito.'
    })
    expect(submitted.status).toBe(202)
    const { id: feedbackId, status } = (await submitted.json()) as { id: string; status: string }
    expect(status).toBe('pending')

    expect(await settle(`/feedback/${feedbackId}`)).toMatchObject({
      suggestionId,
      action: 'reject',
      status: 'completed',
      outcome: 'updated',
      summary: 'El autor usa voseo.'
    })
    expect(
      ((await (await send('GET', `/documents/${DOC}`)).json()) as { profile: { markdown: string } }).profile
        .markdown
    ).toBe('# Perfil con voseo')
  })

  it('refuses feedback on a suggestion the hub never made, or with a malformed id', async () => {
    const { send } = await setup()

    const unknown = await send('POST', '/feedback', { suggestionId: '0123456789abcdef', action: 'accept' })
    const malformed = await send('POST', '/feedback', { suggestionId: 'chunk0-1', action: 'accept' })

    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ code: 'not_found' })
    expect(malformed.status).toBe(400)
  })

  it('reads, saves and clears the correction instructions', async () => {
    const { send } = await setup()

    expect(await (await send('GET', '/preferences')).json()).toEqual({
      correctionInstructions: null,
      correctionInstructionsMaxLength: 4000
    })
    expect(
      await (await send('PUT', '/preferences', { correctionInstructions: '  Respeta el voseo  ' })).json()
    ).toEqual({
      correctionInstructions: 'Respeta el voseo',
      correctionInstructionsMaxLength: 4000
    })
    expect(await (await send('PUT', '/preferences', { correctionInstructions: null })).json()).toMatchObject({
      correctionInstructions: null
    })
    expect((await send('PUT', '/preferences', { correctionInstructions: 'x'.repeat(4001) })).status).toBe(400)
    expect((await send('PUT', '/preferences', { correctionInstructions: 'x', extra: true })).status).toBe(400)
  })

  it('refuses a body over the limit with a payload_too_large problem', async () => {
    const { send } = await setup()

    const response = await send('POST', `/documents/${DOC}/analyses`, {
      genre: 'general',
      chunks: [{ id: '0', text: 'x'.repeat(11 * 1024 * 1024) }]
    })

    expect(response.status).toBe(413)
    expect(await response.json()).toMatchObject({ code: 'payload_too_large' })
  })

  it('publishes its contract as OpenAPI 3.1, with every route behind the bearer token', async () => {
    const { send } = await setup()

    const doc = (await (await send('GET', '/openapi.json')).json()) as {
      openapi: string
      servers: { url: string }[]
      paths: Record<string, Record<string, { security?: unknown }>>
      components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> }
    }

    expect(doc.openapi).toBe('3.1.0')
    expect(doc.servers).toEqual([{ url: '/api/v1' }])
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/analyses/{analysisId}',
      '/analyses/{analysisId}/cancel',
      '/documents/{documentId}',
      '/documents/{documentId}/analyses',
      '/feedback',
      '/feedback/{feedbackId}',
      '/modules',
      '/preferences',
      '/status'
    ])
    for (const operations of Object.values(doc.paths)) {
      for (const operation of Object.values(operations)) expect(operation.security).toEqual([{ Bearer: [] }])
    }
    expect(doc.components.securitySchemes['Bearer']).toMatchObject({ type: 'http', scheme: 'bearer' })
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['Analysis', 'Chunk', 'Suggestion', 'Feedback', 'Problem', 'Status', 'Document'])
    )
  })
})
