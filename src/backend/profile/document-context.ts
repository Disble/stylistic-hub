/** Genres a document can be written in; the same list as stylistics-backend. */
export const DOCUMENT_GENRES = [
  'narrativa-literaria',
  'ensayo-academico',
  'periodismo-cultural',
  'general'
] as const

/** One of the genres. */
export type DocumentGenre = (typeof DOCUMENT_GENRES)[number]

/** Genre of a document nobody has classified yet. */
export const DEFAULT_GENRE: DocumentGenre = 'general'

/** Processing configuration of a new document. */
export const DEFAULT_PROCESSING_CONFIG: Record<string, unknown> = { chunking: { mode: 'default' } }

/** Style profile a new document starts with, copied verbatim from stylistics-backend. */
export const INITIAL_STYLE_PROFILE = `# Perfil estilístico del documento

## PATRONES VIVOS

### Ortografía

### Gramática

### Puntuación

### Tipografía

### Léxico

### Estilo

## CRITERIOS DE INTERVENCIÓN
`

/** What the workflows know about one Word document. There are no users: one hub per Windows user. */
export interface DocumentContext {
  /** Key the add-in stores inside the Word document. */
  documentKey: string
  title: string | null
  genre: DocumentGenre
  processingConfig: Record<string, unknown>
  /** The document's living style profile, in Markdown. */
  profileMarkdown: string
}

/** Identifies a document and optionally updates what the add-in knows about it. */
export interface ResolveDocumentInput {
  documentKey: string
  title?: string
  genre?: DocumentGenre
  processingConfig?: Record<string, unknown>
}
