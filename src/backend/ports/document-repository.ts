import type { DocumentContext, ResolveDocumentInput } from '../profile/document-context'

/** Where document contexts and their style profiles are kept. */
export interface DocumentRepository {
  /** Returns the document's context, creating it with the defaults the first time it is seen. */
  resolve(input: ResolveDocumentInput): DocumentContext
  /** Replaces the style profile of a document that was already resolved. */
  updateStyleProfile(documentKey: string, profileMarkdown: string): void
}
