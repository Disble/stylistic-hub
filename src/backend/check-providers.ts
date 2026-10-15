import { join } from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { z } from 'zod'
import { createPiLlm } from './adapters/pi/pi-llm'
import { createChosenModel } from './adapters/pi/pi-runtime'

/**
 * Validates forced-tool structured output against every provider signed in on this hub (S7):
 * one small request per provider, through the same adapter the workflows use: the model chosen on
 * the Provider screen for its provider, the cheapest of the others. Spends a few tokens per provider. Run: `bun run check:providers [piDir]`.
 */
const piDir = process.argv[2] ?? join(process.env['APPDATA'] ?? '', 'stylistic-hub', 'pi')

/** A tiny answer that still exercises enums, arrays and nested objects. */
const schema = z.object({
  verdict: z.enum(['correct', 'needs-fix']),
  fixes: z.array(z.object({ original: z.string(), replacement: z.string() }))
})

/** Pi over the hub's directory. */
const { runtime, getModel } = await createChosenModel(piDir)
/** The model chosen on the Provider screen, if any. */
const chosen = await getModel()
/** Every model of a signed-in provider. */
const models = await runtime.getAvailable()
/** One model per signed-in provider: the chosen one, or the cheapest. */
const perProvider: Model<Api>[] = []
for (const model of [...models].sort(
  (a, b) => a.cost.input + a.cost.output - (b.cost.input + b.cost.output)
)) {
  if (perProvider.some((m) => m.provider === model.provider)) continue
  perProvider.push(chosen?.provider === model.provider ? chosen : model)
}
if (perProvider.length === 0) {
  console.log(`No signed-in provider in ${piDir}. Sign in on the Provider screen first.`)
  process.exit(1)
}

/** Providers whose structured call failed. */
let failed = 0
for (const model of perProvider) {
  const llm = createPiLlm({ complete: (m, c, o) => runtime.complete(m, c, o), getModel: async () => model })
  try {
    const answer = await llm.structuredCall({
      system: 'You are a Spanish copy editor.',
      prompt: 'Revisa: "Ayer fuistes al mercado."',
      schema,
      temperature: 0
    })
    console.log(`PASS ${model.provider}/${model.id} (${model.api}): ${JSON.stringify(answer)}`)
  } catch (error) {
    failed += 1
    console.log(
      `FAIL ${model.provider}/${model.id} (${model.api}): ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
process.exit(failed === 0 ? 0 : 1)
