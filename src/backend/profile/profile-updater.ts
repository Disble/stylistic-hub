import type { DocumentRepository } from '../ports/document-repository'

/** Turns the profile current at that moment into a new one, or `undefined` to leave it. */
export type ProfileChange = (current: string) => Promise<string | undefined>

/** Read-merge-write of a document's style profile, one at a time per document. */
export interface ProfileUpdater {
  /** Applies `change` to the current profile; true when it changed and was written. */
  update(documentKey: string, change: ProfileChange): Promise<boolean>
}

/**
 * Serializes profile updates per document, so an analysis and a feedback that overlap do not
 * overwrite each other: each change reads the profile only once the previous one has written it.
 * An in-process queue is enough because the hub runs one backend process.
 */
export function createProfileUpdater(documents: DocumentRepository): ProfileUpdater {
  const queues = new Map<string, Promise<unknown>>()
  return {
    async update(documentKey, change) {
      const previous = queues.get(documentKey) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          const current = documents.resolve({ documentKey }).profileMarkdown
          const updated = await change(current)
          if (updated === undefined || updated === current) return false
          documents.updateStyleProfile(documentKey, updated)
          return true
        })
      queues.set(documentKey, next)
      try {
        return await next
      } finally {
        if (queues.get(documentKey) === next) queues.delete(documentKey)
      }
    }
  }
}
