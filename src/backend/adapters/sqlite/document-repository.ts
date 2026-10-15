import type { DatabaseSync } from 'node:sqlite'
import {
  DEFAULT_GENRE,
  DEFAULT_PROCESSING_CONFIG,
  INITIAL_STYLE_PROFILE,
  type DocumentContext,
  type DocumentGenre,
  type ResolveDocumentInput
} from '../../profile/document-context'
import type { DocumentRepository } from '../../ports/document-repository'

/** A row of the `document` table. */
interface DocumentRow {
  document_key: string
  title: string | null
  genre: string
  processing_config: string
  profile_markdown: string
}

/** Document contexts kept in the hub's SQLite database. */
export class SqliteDocumentRepository implements DocumentRepository {
  constructor(private readonly db: DatabaseSync) {}

  /** Creates the document with the defaults, or updates only the fields given, then reads it back. */
  resolve({ documentKey, title, genre, processingConfig }: ResolveDocumentInput): DocumentContext {
    const row = this.db
      .prepare(
        `INSERT INTO document (document_key, title, genre, processing_config, profile_markdown)
         VALUES (:key, :title, coalesce(:genre, :defaultGenre), coalesce(:config, :defaultConfig), :profile)
         ON CONFLICT (document_key) DO UPDATE SET
           title = coalesce(:title, title),
           genre = coalesce(:genre, genre),
           processing_config = coalesce(:config, processing_config)
         RETURNING *`
      )
      .get({
        key: documentKey,
        title: title ?? null,
        genre: genre ?? null,
        defaultGenre: DEFAULT_GENRE,
        config: processingConfig ? JSON.stringify(processingConfig) : null,
        defaultConfig: JSON.stringify(DEFAULT_PROCESSING_CONFIG),
        profile: INITIAL_STYLE_PROFILE
      }) as unknown as DocumentRow
    return {
      documentKey: row.document_key,
      title: row.title,
      genre: row.genre as DocumentGenre,
      processingConfig: JSON.parse(row.processing_config) as Record<string, unknown>,
      profileMarkdown: row.profile_markdown
    }
  }

  /** Replaces the style profile; the document must exist. */
  updateStyleProfile(documentKey: string, profileMarkdown: string): void {
    const { changes } = this.db
      .prepare('UPDATE document SET profile_markdown = ? WHERE document_key = ?')
      .run(profileMarkdown, documentKey)
    if (changes === 0) throw new Error(`Document ${documentKey} not found`)
  }
}
