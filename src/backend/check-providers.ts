import { join } from 'node:path'
import { z } from 'zod'
import { createPiLlm } from './adapters/pi/pi-llm'
import { createChosenModel } from './adapters/pi/pi-runtime'

/**
 * Validates forced-tool structured output against every provider signed in on this hub (S7):
 * one small request per provider, with its first available model, through the same adapter the
 * workflows use. Spends a few tokens per provider. Run: `bun run check:providers [piDir]`.
 */
const piDir = process.argv[2] ?? join(process.env['APPDATA'] ?? '', 'stylistic-hub', 'pi')

/** A tiny answer that still exercises enums, arrays and nested objects. */
const schema = z.object({
  verdict: z.enum(['correct', 'needs-fix']),
  fixes: z.array(z.object({ original: z.string(), replacement: z.string() }))
})

/** Pi over the hub's directory. */
const { runtime } = await createChosenModel(piDir)
/** Every model of a signed-in provider. */
const models = await runtime.getAvailable()
/** One model per signed-in provider: its first. */
const firstPerProvider = [...new Map(models.map((m) => [m.provider, m])).values()]
if (firstPerProvider.length === 0) {
  console.log(`No signed-in provider in ${piDir}. Sign in on the Provider screen first.`)
  process.exit(1)
}

/** Providers whose structured call failed. */
let failed = 0
for (const model of firstPerProvider) {
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
