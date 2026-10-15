import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall
} from '@earendil-works/pi-ai'
import type { Api, AssistantMessage, Context, Model } from '@earendil-works/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createPiLlm, type CompleteFn } from './pi-llm'

/** The answer shape the tests ask for. */
const schema = z.object({ verdict: z.enum(['ok', 'fix']), notes: z.array(z.string()) })

/** A request with the given answer schema. */
const request = { system: 'You are an editor.', prompt: 'Check this text.', schema, temperature: 0 }

/** A model of the given API; only the fields the adapter reads matter. */
function modelOf(api: string): Model<Api> {
  return { id: 'm', name: 'M', api, provider: 'p' } as unknown as Model<Api>
}

/** A `complete` that records its call and answers with `message`. */
function answering(message: AssistantMessage) {
  return vi.fn<CompleteFn>(async () => message)
}

describe('createPiLlm', () => {
  it('round-trips a forced submit call through Pi with a scripted provider', async () => {
    const faux = fauxProvider()
    faux.setResponses([fauxAssistantMessage(fauxToolCall('submit', { verdict: 'fix', notes: ['comma'] }))])
    const models = createModels()
    models.setProvider(faux.provider)
    const llm = createPiLlm({
      complete: (model, context, options) => models.complete(model, context, options),
      getModel: async () => faux.getModel()
    })

    await expect(llm.structuredCall(request)).resolves.toEqual({ verdict: 'fix', notes: ['comma'] })
  })

  it('sends the prompts and one submit tool whose parameters are the JSON Schema of the answer', async () => {
    const fn = answering(fauxAssistantMessage(fauxToolCall('submit', { verdict: 'ok', notes: [] })))
    const llm = createPiLlm({ complete: fn, getModel: async () => modelOf('anthropic-messages') })

    await llm.structuredCall(request)

    const context = fn.mock.calls[0]?.[1] as Context
    expect(context.systemPrompt).toContain('You are an editor.')
    expect(context.messages).toMatchObject([{ role: 'user', content: 'Check this text.' }])
    expect(context.tools).toHaveLength(1)
    expect(context.tools?.[0]).toMatchObject({
      name: 'submit',
      parameters: {
        type: 'object',
        properties: { verdict: { enum: ['ok', 'fix'] } },
        required: ['verdict', 'notes']
      }
    })
    expect(fn.mock.calls[0]?.[2]).toMatchObject({ temperature: 0 })
  })

  it.each([
    ['anthropic-messages', { type: 'tool', name: 'submit' }],
    ['bedrock-converse-stream', { type: 'tool', name: 'submit' }],
    ['openai-completions', { type: 'function', function: { name: 'submit' } }],
    ['mistral-conversations', { type: 'function', function: { name: 'submit' } }],
    ['pi-messages', { type: 'function', function: { name: 'submit' } }],
    ['openai-responses', { type: 'function', name: 'submit' }],
    ['azure-openai-responses', { type: 'function', name: 'submit' }],
    ['google-generative-ai', 'any'],
    ['google-vertex', 'any'],
    ['openai-codex-responses', 'required']
  ])('forces the submit tool on %s', async (api, toolChoice) => {
    const fn = answering(fauxAssistantMessage(fauxToolCall('submit', { verdict: 'ok', notes: [] })))
    const llm = createPiLlm({ complete: fn, getModel: async () => modelOf(api) })

    await llm.structuredCall(request)

    expect(fn.mock.calls[0]?.[2]).toMatchObject({ toolChoice })
  })

  it('leaves the tool choice to an unknown API and still requires the submit call', async () => {
    const fn = answering(fauxAssistantMessage(fauxToolCall('submit', { verdict: 'ok', notes: [] })))
    const llm = createPiLlm({ complete: fn, getModel: async () => modelOf('some-future-api') })

    await llm.structuredCall(request)

    expect(fn.mock.calls[0]?.[2]).not.toHaveProperty('toolChoice')
  })

  it('fails when the model answers with text instead of the submit call', async () => {
    const llm = createPiLlm({
      complete: answering(fauxAssistantMessage(fauxText('Here is my answer'))),
      getModel: async () => modelOf('anthropic-messages')
    })

    await expect(llm.structuredCall(request)).rejects.toThrow(/did not call submit/)
  })

  it('fails when the submitted answer does not match the schema', async () => {
    const llm = createPiLlm({
      complete: answering(fauxAssistantMessage(fauxToolCall('submit', { verdict: 'maybe', notes: [] }))),
      getModel: async () => modelOf('anthropic-messages')
    })

    await expect(llm.structuredCall(request)).rejects.toThrow(/does not match the schema.*verdict/s)
  })

  it('reports the provider error of a failed request', async () => {
    const llm = createPiLlm({
      complete: answering(fauxAssistantMessage([], { stopReason: 'error', errorMessage: 'rate limited' })),
      getModel: async () => modelOf('anthropic-messages')
    })

    await expect(llm.structuredCall(request)).rejects.toThrow(/rate limited/)
  })

  it('asks for a model when none is chosen', async () => {
    const llm = createPiLlm({ complete: vi.fn<CompleteFn>(), getModel: async () => undefined })

    await expect(llm.structuredCall(request)).rejects.toThrow(/Choose a model/)
  })
})
