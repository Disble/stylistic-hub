import { describe, expect, it } from 'vitest'
import { openDatabase } from '../sqlite/database'
import { SqlitePreferencesRepository } from '../sqlite/preferences-repository'
import { preferencesRoutes } from './preferences-routes'

/** The real repository on a database that lives only for the test. */
function memoryPreferences() {
  return new SqlitePreferencesRepository(openDatabase(':memory:'))
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

  it('clears the instructions with null', async () => {
    const routes = preferencesRoutes(memoryPreferences())
    await routes.request('/', put(JSON.stringify({ correctionInstructions: 'Algo.' })))

    const cleared = await routes.request('/', put(JSON.stringify({ correctionInstructions: null })))

    expect(await cleared.json()).toMatchObject({ correctionInstructions: null })
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
