import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  ProviderStreamOptions,
  Tool
} from '@earendil-works/pi-ai'
import { z, type ZodType } from 'zod'
import type { LlmPort } from '../../ports/llm'

/** Pi's `complete`: `ModelRuntime.complete` in the hub, `pi-ai`'s own in tests. */
export type CompleteFn = (
  model: Model<Api>,
  context: Context,
  options?: ProviderStreamOptions
) => Promise<AssistantMessage>

/** What the adapter needs from Pi. */
export interface PiLlmDeps {
  complete: CompleteFn
  /** The model chosen on the Provider screen, or nothing when none is. */
  getModel(): Promise<Model<Api> | undefined>
}

/** Name of the only tool the model is given. */
const SUBMIT = 'submit'

/** The answer schema as tool parameters, without the `$schema` marker providers do not need. */
function parametersOf(schema: ZodType): Tool['parameters'] {
  const parameters: Record<string, unknown> = z.toJSONSchema(schema)
  delete parameters['$schema']
  return parameters as Tool['parameters']
}

/**
 * Pi's provider-neutral `toolChoice` is only `auto` or `none`, so forcing one tool takes each API's
 * own option. An API missing here keeps its default; the answer is still required to be a submit call.
 */
const FORCED_TOOL_CHOICE: Record<string, unknown> = {
  'anthropic-messages': { type: 'tool', name: SUBMIT },
  'bedrock-converse-stream': { type: 'tool', name: SUBMIT },
  'openai-completions': { type: 'function', function: { name: SUBMIT } },
  'mistral-conversations': { type: 'function', function: { name: SUBMIT } },
  'pi-messages': { type: 'function', function: { name: SUBMIT } },
  'openai-responses': { type: 'function', name: SUBMIT },
  'azure-openai-responses': { type: 'function', name: SUBMIT },
  'google-generative-ai': 'any',
  'google-vertex': 'any',
  'openai-codex-responses': 'required'
}

/**
 * Pi turns optional properties into required nullable ones for strict tools, so an omitted field
 * arrives as `null`. Drops those keys; used only when the answer does not parse as sent.
 */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNulls)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, withoutNulls(v)])
  )
}

/**
 * Structured output over Pi: the answer schema becomes the parameters of a `submit` tool the model
 * is forced to call, and zod validates what it submits. Custom code: Pi has no structured-output
 * call (see docs/architecture.md).
 */
export function createPiLlm({ complete, getModel }: PiLlmDeps): LlmPort {
  return {
    async structuredCall({ system, prompt, schema, temperature, signal }) {
      const model = await getModel()
      if (!model) throw new Error('Choose a model on the Provider screen first')

      const tool: Tool = {
        name: SUBMIT,
        description: 'Submit your final answer. Call this exactly once.',
        parameters: parametersOf(schema),
        constrainedSampling: { type: 'json_schema', strict: 'prefer' }
      }
      // Pi always sends adaptive thinking to these models, and thinking only allows `auto`/`none`.
      const alwaysThinks = (model.compat as { supportsMidConvoEffort?: boolean } | undefined)
        ?.supportsMidConvoEffort
      const toolChoice = alwaysThinks ? undefined : FORCED_TOOL_CHOICE[model.api]
      const message = await complete(
        model,
        {
          systemPrompt: `${system}\n\nAnswer only by calling the ${SUBMIT} tool.`,
          messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
          tools: [tool]
        },
        {
          ...(temperature === undefined ? {} : { temperature }),
          ...(signal === undefined ? {} : { signal }),
          ...(toolChoice === undefined ? {} : { toolChoice })
        } as ProviderStreamOptions
      )

      if (message.stopReason === 'error' || message.stopReason === 'aborted') {
        throw new Error(`The model request failed: ${message.errorMessage ?? message.stopReason}`)
      }
      const call = message.content.find((block) => block.type === 'toolCall' && block.name === SUBMIT)
      if (!call || call.type !== 'toolCall')
        throw new Error(
          `${model.provider}/${model.id} did not call ${SUBMIT} (stop reason: ${message.stopReason})`
        )
      const asSent = schema.safeParse(call.arguments)
      const parsed = asSent.success ? asSent : schema.safeParse(withoutNulls(call.arguments))
      if (!parsed.success) {
        throw new Error(`The submitted answer does not match the schema: ${z.prettifyError(parsed.error)}`)
      }
      return parsed.data
    }
  }
}
