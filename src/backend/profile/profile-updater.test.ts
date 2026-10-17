import { describe, expect, it } from 'vitest'
import type { DocumentRepository } from '../ports/document-repository'
import { createProfileUpdater } from './profile-updater'

/** A document repository in memory, holding one profile per document key. */
function memoryDocuments(initial: string): DocumentRepository & { profiles: Map<string, string> } {
  const profiles = new Map<string, string>()
  return {
    profiles,
    resolve: ({ documentKey }) => {
      if (!profiles.has(documentKey)) profiles.set(documentKey, initial)
      return {
        documentKey,
        title: null,
        genre: 'general',
        processingConfig: {},
        profileMarkdown: profiles.get(documentKey) ?? initial
      }
    },
    get: () => undefined,
    updateStyleProfile: (documentKey, markdown) => void profiles.set(documentKey, markdown)
  }
}

/** Lets other pending promises run, as a model call would. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('createProfileUpdater', () => {
  it('keeps both changes when two updates of one document overlap', async () => {
    const documents = memoryDocuments('# Perfil')
    const profile = createProfileUpdater(documents)

    await Promise.all([
      profile.update('doc', async (current) => (await tick(), `${current}\n- de la corrección`)),
      profile.update('doc', async (current) => (await tick(), `${current}\n- del feedback`))
    ])

    expect(documents.profiles.get('doc')).toBe('# Perfil\n- de la corrección\n- del feedback')
  })

  it('does not hold back other documents', async () => {
    const documents = memoryDocuments('# Perfil')
    const profile = createProfileUpdater(documents)
    const order: string[] = []

    await Promise.all([
      profile.update(
        'slow',
        async (current) => (await tick(), await tick(), order.push('slow'), current + '!')
      ),
      profile.update('fast', async (current) => (order.push('fast'), current + '!'))
    ])

    expect(order).toEqual(['fast', 'slow'])
  })

  it('says whether the profile changed, and writes nothing when it did not', async () => {
    const documents = memoryDocuments('# Perfil')
    const profile = createProfileUpdater(documents)

    expect(await profile.update('doc', async () => undefined)).toBe(false)
    expect(await profile.update('doc', async (current) => current)).toBe(false)
    expect(await profile.update('doc', async () => '# Nuevo')).toBe(true)
    expect(documents.profiles.get('doc')).toBe('# Nuevo')
  })

  it('lets the next update run after one that failed', async () => {
    const documents = memoryDocuments('# Perfil')
    const profile = createProfileUpdater(documents)

    const failed = profile.update('doc', async () => {
      throw new Error('The model request failed')
    })
    const next = profile.update('doc', async (current) => `${current}\n- después`)

    await expect(failed).rejects.toThrow('The model request failed')
    expect(await next).toBe(true)
    expect(documents.profiles.get('doc')).toBe('# Perfil\n- después')
  })
})
