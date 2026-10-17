import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteAnalysisRepository } from '../adapters/sqlite/analysis-repository'
import { openDatabase } from '../adapters/sqlite/database'
import { SqliteDocumentRepository } from '../adapters/sqlite/document-repository'
import type { LlmPort, StructuredCallInput } from '../ports/llm'
import type { Step, WorkflowBody } from '../ports/workflow-engine'
import { INITIAL_STYLE_PROFILE } from '../profile/document-context'
import { createProfileUpdater } from '../profile/profile-updater'
import {
  ANALYSIS_WORKFLOW,
  analysisWorkflow,
  analyzePartWorkflow,
  PART_WORKFLOW,
  PROFILE_WORKFLOW,
  updateProfileWorkflow,
  type AnalysisInput
} from './analysis-workflow'
import { messageOf } from './errors'
import { DOCUMENT_PROFILE_AGENT_INSTRUCTIONS } from './prompts/document-profile-agent.prompt'
import { STYLISTIC_AGENT_INSTRUCTIONS } from './prompts/stylistic-agent.prompt'
import { updateDocumentStyleProfileResultSchema } from './schemas'

/** A document key as the add-in generates it. */
const DOC = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'

/** What the correction model answers for a part: a replacement, one that is really a comment, one unplaceable. */
function correctionFor(prompt: string) {
  const text = prompt.includes('Ayer fuistes al mercado.') ? 'Ayer fuistes al mercado.' : 'Otro texto.'
  return {
    suggestions: [
      {
        type: 'track-change',
        context: text,
        anchor: text.split(' ')[1],
        suggestedText: 'fuiste',
        justification: 'Segunda persona del pretérito sin -s.',
        category: 'gramatica',
        severity: 'high'
      },
      {
        type: 'track-change',
        context: 'al mercado.',
        anchor: 'mercado',
        suggestedText: 'mercado',
        justification: 'Sin cambio.',
        category: 'estilo',
        severity: 'low'
      },
      {
        type: 'comment-only',
        context: 'al mercado.',
        anchor: 'la plaza',
        justification: 'El anchor no está en el contexto.',
        category: 'estilo',
        severity: 'low'
      }
    ],
    cleanPatterns: ['tildes diacríticas']
  }
}

/** Fresh folder for each test's database file. */
let dir: string
/** This test's database. */
let db: DatabaseSync

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hub-analysis-wf-'))
  db = openDatabase(join(dir, 'stylistic.db'))
})

afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * The analysis workflows over real repositories, run by an inline engine: steps run at once and
 * a child runs its body in place, a throw becoming a failed result as the engine reports it. `fail` makes a correction call throw for prompts containing it.
 */
function setup({
  instructions,
  profile = INITIAL_STYLE_PROFILE,
  fail,
  failProfile = false,
  profileAnswer = '# Perfil actualizado'
}: {
  instructions?: string
  profile?: string
  fail?: string
  failProfile?: boolean
  profileAnswer?: string
} = {}) {
  const documents = new SqliteDocumentRepository(db)
  documents.resolve({ documentKey: DOC })
  if (profile !== INITIAL_STYLE_PROFILE) documents.updateStyleProfile(DOC, profile)
  const analyses = new SqliteAnalysisRepository(db)
  const steps: string[] = []
  const calls: StructuredCallInput<unknown>[] = []
  const structuredCall = async (input: StructuredCallInput<unknown>): Promise<unknown> => {
    calls.push(input)
    if (input.schema === updateDocumentStyleProfileResultSchema) {
      if (failProfile) throw new Error('The model request failed: 529 overloaded')
      return { profileMarkdown: profileAnswer, changeSummary: 'Añadido un patrón.' }
    }
    if (fail && input.prompt.includes(fail)) throw new Error('The model request failed: 400 bad request')
    return input.schema.parse(correctionFor(input.prompt))
  }
  const deps = {
    llm: { structuredCall } as LlmPort,
    documents,
    analyses,
    profile: createProfileUpdater(documents),
    correctionInstructions: async () => instructions
  }
  const bodies: Record<string, WorkflowBody> = {
    [ANALYSIS_WORKFLOW]: analysisWorkflow(deps),
    [PART_WORKFLOW]: analyzePartWorkflow(deps),
    [PROFILE_WORKFLOW]: updateProfileWorkflow(deps)
  }
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
  /** Creates the analysis as the API does and runs it to the end. */
  const run = async (chunks: AnalysisInput['chunks'], genre: AnalysisInput['genre'] = 'general') => {
    analyses.create({
      id: 'a1',
      documentId: DOC,
      chunks: chunks.map((c) => ({ id: c.id, parts: c.parts.length }))
    })
    await bodies[ANALYSIS_WORKFLOW]?.({ analysisId: 'a1', documentId: DOC, genre, chunks }, step, {
      id: 'run'
    })
    return analyses.get('a1')
  }
  return { run, steps, calls, documents, analyses, bodies, step }
}

describe('analysis workflows', () => {
  it('corrects each part, keeps only placeable suggestions, and completes the analysis', async () => {
    const { run, steps } = setup()

    const analysis = await run([{ id: '0', parts: ['Ayer fuistes al mercado.'] }])

    expect(analysis?.status).toBe('completed')
    const chunk = analysis?.chunks[0]
    expect(chunk?.status).toBe('completed')
    expect(chunk?.dropped).toBe(1)
    expect(chunk?.suggestions).toEqual([
      expect.objectContaining({ type: 'track-change', anchor: 'fuistes', suggestedText: 'fuiste' }),
      expect.objectContaining({ type: 'comment-only', anchor: 'mercado' })
    ])
    expect(chunk?.suggestions[1]).not.toHaveProperty('suggestedText')
    expect(steps).toEqual([
      'start',
      'load-profile',
      'preference-guided-correction',
      'correct-text',
      'save',
      'update-profile',
      'finish'
    ])
  })

  it('updates the profile once for the whole analysis, from every part', async () => {
    const { run, calls, documents } = setup()

    const analysis = await run([
      { id: '0', parts: ['Ayer fuistes al mercado.', 'Otro texto.'] },
      { id: '1', parts: ['Otro texto.'] }
    ])

    const updates = calls.filter((c) => c.system === DOCUMENT_PROFILE_AGENT_INSTRUCTIONS)
    expect(updates).toHaveLength(1)
    expect(updates[0]?.prompt).toContain('"anchor": "fuistes"')
    expect(updates[0]?.prompt).toContain('"anchor": "texto."')
    expect(analysis?.profile).toBe('updated')
    expect(documents.get(DOC)?.profileMarkdown).toBe('# Perfil actualizado')
  })

  it('records a failed part on its chunk with the provider message and keeps the others', async () => {
    const { run } = setup({ fail: 'Otro texto.' })

    const analysis = await run([
      { id: '0', parts: ['Ayer fuistes al mercado.'] },
      { id: '1', parts: ['Otro texto.'] }
    ])

    expect(analysis?.status).toBe('partial')
    expect(analysis?.chunks.map((c) => [c.id, c.status])).toEqual([
      ['0', 'completed'],
      ['1', 'failed']
    ])
    expect(analysis?.chunks[1]?.error).toBe('The model request failed: 400 bad request')
    expect(analysis?.profile).toBe('updated')
  })

  it('fails the analysis when every part fails, and leaves the profile alone', async () => {
    const { run, calls } = setup({ fail: 'Ayer' })

    const analysis = await run([{ id: '0', parts: ['Ayer fuistes al mercado.'] }])

    expect(analysis?.status).toBe('failed')
    expect(analysis?.profile).toBe('unchanged')
    expect(calls.some((c) => c.system === DOCUMENT_PROFILE_AGENT_INSTRUCTIONS)).toBe(false)
  })

  it('keeps the suggestions when only the profile update fails', async () => {
    const { run } = setup({ failProfile: true })

    const analysis = await run([{ id: '0', parts: ['Ayer fuistes al mercado.'] }])

    expect(analysis?.status).toBe('completed')
    expect(analysis?.profile).toBe('failed')
    expect(analysis?.chunks[0]?.suggestions).toHaveLength(2)
  })

  it('marks the profile unchanged when the model gives it back as it was', async () => {
    const { run, documents } = setup({ profileAnswer: INITIAL_STYLE_PROFILE })

    const analysis = await run([{ id: '0', parts: ['Ayer fuistes al mercado.'] }])

    expect(analysis?.profile).toBe('unchanged')
    expect(documents.get(DOC)?.profileUpdatedAt).toBeNull()
  })

  it.each([
    ['canceled', true],
    ['gone', false]
  ])('learns nothing for an analysis that is %s', async (_case, exists) => {
    const { analyses, bodies, step, calls } = setup()
    if (exists) {
      analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })
      analyses.cancel('a1')
    }
    const learn = { analysisId: 'a1', documentId: DOC, suggestions: [], cleanPatterns: ['tildes'] }

    await bodies[PROFILE_WORKFLOW]?.(learn, step, { id: 'profile' })

    expect(calls).toEqual([])
  })

  it('runs no part and changes no profile once the analysis is canceled', async () => {
    const { analyses, calls, documents } = setup()
    analyses.create({ id: 'a1', documentId: DOC, chunks: [{ id: '0', parts: 1 }] })
    analyses.cancel('a1')
    const part = analyzePartWorkflow({
      llm: { structuredCall: async () => ({}) } as unknown as LlmPort,
      documents,
      analyses,
      profile: createProfileUpdater(documents),
      correctionInstructions: async () => undefined
    })
    const inline: Step = {
      run: async (_name, fn) => fn(),
      child: async () => ({ ok: true, value: undefined as never })
    }

    const output = await part(
      { analysisId: 'a1', documentId: DOC, genre: 'general', chunkId: '0', part: 0, text: 'Texto.' },
      inline,
      { id: 'child' }
    )

    expect(output).toBeNull()
    expect(calls).toHaveLength(0)
    expect(analyses.get('a1')?.status).toBe('canceled')
  })

  it('corrects with the stylistic agent at temperature 0 and the document profile in the prompt', async () => {
    const { run, calls } = setup()

    await run([{ id: '0', parts: ['Ayer fuistes al mercado.'] }])

    expect(calls[0]).toMatchObject({ system: STYLISTIC_AGENT_INSTRUCTIONS, temperature: 0 })
    expect(calls[0]?.prompt).toContain('Ayer fuistes al mercado.')
    expect(calls[0]?.prompt).toContain('PATRONES VIVOS')
    expect(calls[0]?.prompt).not.toContain('<correcion-previa>')
  })

  it('runs a preference pass first when the user has correction instructions', async () => {
    const { run, calls } = setup({ instructions: 'Prefiero comillas angulares.' })

    await run([{ id: '0', parts: ['Ayer fuistes al mercado.'] }])

    expect(calls[0]?.prompt).toContain('Prefiero comillas angulares.')
    expect(calls[1]?.prompt).toContain('<correcion-previa>')
  })

  it('frames literary fiction as editorial work', async () => {
    const { run, calls } = setup()

    await run([{ id: '0', parts: ['Lo mató al alba.'] }], 'narrativa-literaria')

    expect(calls[0]?.prompt).toContain('<marco-editorial>')
  })

  it.each([
    [548, 'ZONA VERDE', 549],
    [549, 'ZONA AMARILLA', 550],
    [799, 'ZONA AMARILLA', 800],
    [800, 'ZONA ROJA', 801]
  ])('counts %i pattern words plus the heading into the %s', async (words, zone, total) => {
    const patterns = Array.from({ length: words }, () => 'palabra').join(' ')
    const profile = `# Perfil

## PATRONES VIVOS

### Estilo
${patterns}

## CRITERIOS
fuera de la sección`
    const { run, calls } = setup({ profile })

    await run([{ id: '0', parts: ['Texto.'] }])

    // "Estilo" is a word of the section too.
    const update = calls.find((c) => c.system === DOCUMENT_PROFILE_AGENT_INSTRUCTIONS)
    expect(update?.prompt).toContain(`PATRONES VIVOS: ${total} palabras`)
    expect(update?.prompt).toContain(`ESTADO: ${zone}`)
  })

  it('counts living patterns up to the end of a profile that ends with that section', async () => {
    const { run, calls } = setup({ profile: '# Perfil\n\n## PATRONES VIVOS\n\nuno dos tres' })

    await run([{ id: '0', parts: ['Texto.'] }])

    const update = calls.find((c) => c.system === DOCUMENT_PROFILE_AGENT_INSTRUCTIONS)
    expect(update?.prompt).toContain('PATRONES VIVOS: 3 palabras')
  })

  it('counts no living patterns in a profile without that section', async () => {
    const { run, calls } = setup({ profile: '# Perfil\n\nSolo notas.' })

    await run([{ id: '0', parts: ['Texto.'] }])

    const update = calls.find((c) => c.system === DOCUMENT_PROFILE_AGENT_INSTRUCTIONS)
    expect(update?.prompt).toContain('PATRONES VIVOS: 0 palabras')
    expect(update?.prompt).toContain('ESTADO: ZONA VERDE')
  })

  it('tells the model there is no profile when the document has an empty one', async () => {
    const { run, calls } = setup({ profile: '' })

    await run([{ id: '0', parts: ['Texto.'] }])

    expect(calls[0]?.prompt).toContain('No hay perfil previo disponible para este autor.')
  })
})
