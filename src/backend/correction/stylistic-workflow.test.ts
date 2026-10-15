import { describe, expect, it } from 'vitest'
import type { LlmPort, StructuredCallInput } from '../ports/llm'
import type { Step } from '../ports/workflow-engine'
import {
  INITIAL_STYLE_PROFILE,
  type DocumentContext,
  type ResolveDocumentInput
} from '../profile/document-context'
import { DOCUMENT_PROFILE_AGENT_INSTRUCTIONS } from './prompts/document-profile-agent.prompt'
import { STYLISTIC_AGENT_INSTRUCTIONS } from './prompts/stylistic-agent.prompt'
import { updateDocumentStyleProfileResultSchema } from './schemas'
import { stylisticWorkflow } from './stylistic-workflow'

/** A document key as the add-in generates it. */
const documentUuid = '3f1c2b8e-4d5a-4e6f-9a7b-1c2d3e4f5a6b'

/** What the correction model answers: one suggestion that is really a comment, one replacement. */
const correction = {
  suggestions: [
    {
      type: 'track-change',
      context: 'Ayer fuistes al mercado.',
      anchor: 'fuistes',
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
    }
  ],
  cleanPatterns: ['tildes diacríticas']
}

/** Runs the workflow with an inline step runner that records the step names. */
function setup({
  instructions,
  profile = INITIAL_STYLE_PROFILE
}: { instructions?: string; profile?: string } = {}) {
  const steps: string[] = []
  const step: Step = async (name, run) => {
    steps.push(name)
    return run()
  }
  const calls: StructuredCallInput<unknown>[] = []
  const structuredCall = async (input: StructuredCallInput<unknown>): Promise<unknown> => {
    calls.push(input)
    if (input.schema === updateDocumentStyleProfileResultSchema) {
      return { profileMarkdown: '# Perfil actualizado', changeSummary: 'Añadido un patrón.' }
    }
    return input.schema.parse(correction)
  }
  const llm = { structuredCall } as LlmPort
  const resolved: ResolveDocumentInput[] = []
  const profiles = new Map<string, string>()
  const documents = {
    resolve: (input: ResolveDocumentInput): DocumentContext => {
      resolved.push(input)
      return {
        documentKey: input.documentKey,
        title: input.title ?? null,
        genre: input.genre ?? 'general',
        processingConfig: {},
        profileMarkdown: profile
      }
    },
    updateStyleProfile: (key: string, markdown: string) => void profiles.set(key, markdown)
  }
  const body = stylisticWorkflow({ llm, documents, correctionInstructions: async () => instructions })
  return { run: (input: unknown) => body(input, step), steps, calls, resolved, profiles }
}

describe('stylisticWorkflow', () => {
  it('runs the original four steps and returns the normalized suggestions', async () => {
    const { run, steps } = setup()

    const result = await run({ text: 'Ayer fuistes al mercado.', documentUuid })

    expect(steps).toEqual([
      'load-author-profile',
      'preference-guided-correction',
      'correct-text',
      'update-profile'
    ])
    expect(result).toEqual({
      suggestions: [
        expect.objectContaining({ type: 'track-change', anchor: 'fuistes', suggestedText: 'fuiste' }),
        expect.not.objectContaining({ suggestedText: expect.anything() })
      ],
      cleanPatterns: ['tildes diacríticas']
    })
    expect((result as { suggestions: { type: string }[] }).suggestions[1]?.type).toBe('comment-only')
  })

  it('resolves the document with what the add-in sends', async () => {
    const { run, resolved } = setup()

    await run({
      text: 'Texto.',
      documentUuid,
      genero: 'ensayo-academico',
      title: 'Tesis',
      processingConfig: { a: 1 }
    })

    expect(resolved).toEqual([
      { documentKey: documentUuid, title: 'Tesis', genre: 'ensayo-academico', processingConfig: { a: 1 } }
    ])
  })

  it('corrects with the stylistic agent at temperature 0 and the document profile in the prompt', async () => {
    const { run, calls } = setup()

    await run({ text: 'Ayer fuistes al mercado.', documentUuid })

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ system: STYLISTIC_AGENT_INSTRUCTIONS, temperature: 0 })
    expect(calls[0]?.prompt).toContain('Ayer fuistes al mercado.')
    expect(calls[0]?.prompt).toContain('PATRONES VIVOS')
    expect(calls[0]?.prompt).not.toContain('<correcion-previa>')
  })

  it('runs a preference pass first when the user has correction instructions', async () => {
    const { run, calls } = setup({ instructions: 'Prefiero comillas angulares.' })

    await run({ text: 'Ayer fuistes al mercado.', documentUuid })

    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({ system: STYLISTIC_AGENT_INSTRUCTIONS, temperature: 0 })
    expect(calls[0]?.prompt).toContain('Prefiero comillas angulares.')
    expect(calls[1]?.prompt).toContain('<correcion-previa>')
  })

  it('updates the profile with the profile agent and the word count of its living patterns', async () => {
    const { run, calls, profiles } = setup()

    await run({ text: 'Ayer fuistes al mercado.', documentUuid })

    const update = calls[1]
    expect(update?.system).toBe(DOCUMENT_PROFILE_AGENT_INSTRUCTIONS)
    expect(update?.prompt).toMatch(/Conteo determinístico de palabras para ## PATRONES VIVOS: \d+ palabras/)
    expect(update?.prompt).toContain('"anchor": "fuistes"')
    expect(profiles.get(documentUuid)).toBe('# Perfil actualizado')
  })

  it('rejects input the original schema rejects', async () => {
    const { run, steps } = setup()

    await expect(run({ text: 'Texto.', documentUuid: 'not-a-uuid' })).rejects.toThrow(/documentUuid/)
    await expect(run({ text: 'Texto.', documentUuid, title: '  ' })).rejects.toThrow(/title/)
    expect(steps).toEqual([])
  })

  it('frames literary fiction as editorial work', async () => {
    const { run, calls } = setup()

    await run({ text: 'Lo mató al alba.', documentUuid, genero: 'narrativa-literaria' })

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

    await run({ text: 'Texto.', documentUuid })

    // "Estilo" is a word of the section too.
    expect(calls[1]?.prompt).toContain(`PATRONES VIVOS: ${total} palabras`)
    expect(calls[1]?.prompt).toContain(`ESTADO: ${zone}`)
  })

  it('counts no living patterns in a profile without that section', async () => {
    const { run, calls } = setup({ profile: '# Perfil\n\nSolo notas.' })

    await run({ text: 'Texto.', documentUuid })

    expect(calls[1]?.prompt).toContain('PATRONES VIVOS: 0 palabras')
    expect(calls[1]?.prompt).toContain('ESTADO: ZONA VERDE')
  })

  it('counts living patterns that close the profile', async () => {
    const { run, calls } = setup({ profile: '# Perfil\n\n## PATRONES VIVOS\nuna dos tres' })

    await run({ text: 'Texto.', documentUuid })

    expect(calls[1]?.prompt).toContain('PATRONES VIVOS: 3 palabras')
  })

  it('tells the model there is no profile when the document has an empty one', async () => {
    const { run, calls } = setup({ profile: '' })

    await run({ text: 'Texto.', documentUuid })

    expect(calls[0]?.prompt).toContain('No hay perfil previo disponible para este autor.')
  })
})
