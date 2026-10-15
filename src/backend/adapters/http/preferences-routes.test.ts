import { describe, expect, it } from 'vitest'
import type { PreferencesRepository } from '../../ports/preferences-repository'
import { preferencesRoutes } from './preferences-routes'

/** A repository kept in memory, normalizing as the real one does. */
function memoryPreferences(): PreferencesRepository {
  let saved: string | null = null
  return {
    getCorrectionInstructions: () => saved,
    setCorrectionInstructions: (value) => (saved = value?.trim() || null)
  }
}

/** A PUT with a raw body. */
function put(body: string): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body }
}

describe('preferencesRoutes', () => {
  it('answers the instructions and their maximum length, as stylistics-backend did', async () => {
    const routes = preferencesRoutes(memoryPreferences())

    const response = await routes.request('/')

    expect(await response.json()).toEqual({
      correctionInstructions: null,
      correctionInstructionsMaxLength: 4000
    })
  })

  it('saves instructions and answers what was stored', async () => {
    const routes = preferencesRoutes(memoryPreferences())

    const saved = await routes.request(
      '/',
      put(JSON.stringify({ correctionInstructions: ' Sin adverbios en -mente. ' }))
    )

    expect(await saved.json()).toEqual({
      correctionInstructions: 'Sin adverbios en -mente.',
      correctionInstructionsMaxLength: 4000
    })
    expect(await (await routes.request('/')).json()).toMatchObject({
      correctionInstructions: 'Sin adverbios en -mente.'
    })
  })

  it('rejects a body that is not JSON', async () => {
    const response = await preferencesRoutes(memoryPreferences()).request('/', put('{nope'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_json_body' })
  })

  it.each([
    ['too long', { correctionInstructions: 'a'.repeat(4001) }],
    ['missing the field', {}],
    ['an unknown field', { correctionInstructions: null, other: 1 }]
  ])('rejects a request %s', async (_case, body) => {
    const response = await preferencesRoutes(memoryPreferences()).request('/', put(JSON.stringify(body)))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid_user_preferences_request' })
  })
})
