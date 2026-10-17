import type { DocumentContext, DocumentGenre, ResolveDocumentInput } from '../profile/document-context'

/** A document as the API shows it. */
export interface StoredDocument {
  documentKey: string
  genre: DocumentGenre
  profileMarkdown: string
  /** When the profile last changed; null while it is the initial template. */
  profileUpdatedAt: string | null
}

/** Where document contexts and their style profiles are kept. */
export interface DocumentRepository {
  /** Returns the document's context, creating it with the defaults the first time it is seen. */
  resolve(input: ResolveDocumentInput): DocumentContext
  /** The document, or nothing before its first analysis. */
  get(documentKey: string): StoredDocument | undefined
  /** Replaces the style profile of a document that was already resolved. */
  updateStyleProfile(documentKey: string, profileMarkdown: string): void
}
