// Copied verbatim from stylistics-backend@8165af5 (load-author-profile.helpers.ts and
// update-profile.helpers.ts). Hub change: the profile is identified by the document key.
import type { StylisticWorkflowOutput } from './schemas'

/** Input used to generate the next persisted document style profile. */
type UpdateDocumentStyleProfileInput = {
  documentKey: string
  currentProfileMarkdown: string
  correctionPatternsWordCount: number
  suggestions: StylisticWorkflowOutput['suggestions']
  cleanPatterns: string[]
}

/** Heading of the profile's living-patterns section. */
const CORRECTION_PATTERNS_SECTION_HEADING = '## PATRONES VIVOS'
/** Start of any top-level section. */
const TOP_LEVEL_SECTION_PATTERN = /^##\s+/gm
/** One word, letters or digits, with inner apostrophes or hyphens. */
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu

/**
 * Extracts the markdown body that belongs to the living-patterns section. The
 * heading itself is excluded so the count reflects stored correction patterns,
 * not structural markdown.
 */
function extractProfileCorrectionPatternsSection(profileMarkdown: string) {
  const correctionPatternsHeadingIndex = profileMarkdown.indexOf(CORRECTION_PATTERNS_SECTION_HEADING)

  if (correctionPatternsHeadingIndex === -1) {
    return ''
  }

  const sectionBodyStartIndex = correctionPatternsHeadingIndex + CORRECTION_PATTERNS_SECTION_HEADING.length
  TOP_LEVEL_SECTION_PATTERN.lastIndex = sectionBodyStartIndex

  const nextTopLevelSectionMatch = TOP_LEVEL_SECTION_PATTERN.exec(profileMarkdown)
  const sectionBodyEndIndex = nextTopLevelSectionMatch?.index ?? profileMarkdown.length

  return profileMarkdown.slice(sectionBodyStartIndex, sectionBodyEndIndex).trim()
}

/** Counts words in the persisted living correction-patterns layer deterministically. */
export function countProfileCorrectionPatternsWords(profileMarkdown: string) {
  return extractProfileCorrectionPatternsSection(profileMarkdown).match(WORD_PATTERN)?.length ?? 0
}

/** Below this many words the living patterns are in the green zone. */
const PROFILE_WORD_COUNT_MIN = 550
/** Above this many words they are in the red zone and must be compacted. */
const PROFILE_WORD_COUNT_MAX = 800

/** The metrics block telling the profile agent how much room the living patterns have left. */
function buildWordCountInstructions(correctionPatternsWordCount: number): string {
  const metricsLine =
    `Conteo determinístico de palabras para ## PATRONES VIVOS: ${correctionPatternsWordCount} palabras ` +
    `(min=${PROFILE_WORD_COUNT_MIN}, max=${PROFILE_WORD_COUNT_MAX}).\n`

  if (correctionPatternsWordCount > PROFILE_WORD_COUNT_MAX) {
    return (
      metricsLine +
      'ESTADO: ZONA ROJA. Compacta el perfil vivo.\n' +
      '- Fusiona patrones semánticamente duplicados dentro de la categoría canónica.\n' +
      '- Conserva los criterios de intervención intactos salvo que la evidencia actual exija directamente un cambio.\n'
    )
  }

  if (correctionPatternsWordCount >= PROFILE_WORD_COUNT_MIN) {
    return (
      metricsLine +
      'ESTADO: ZONA AMARILLA. Aplica una actualización normal con presión estricta contra duplicados.\n'
    )
  }

  return metricsLine + 'ESTADO: ZONA VERDE. Aplica una actualización normal.\n'
}

/** Builds the prompt used by the update-profile step. */
export function buildUpdateProfilePrompt(input: UpdateDocumentStyleProfileInput): string {
  const wordCountInstructions = buildWordCountInstructions(input.correctionPatternsWordCount)

  return `<contrato>
Actualiza el perfil documental persistido con id \`${input.documentKey}\`.
Aplica estrictamente la Política de escritura segura de tu protocolo canónico.
Este prompt solo define el estado determinístico de la ejecución; las reglas de edición, preservación, borrado, transición y aborto viven en tu protocolo.
Trata el markdown provisto como documento objetivo. No inventes rutas, no menciones workspace y no devuelvas prosa libre fuera del output estructurado.
Preserva la estructura canónica completa de \`## PATRONES VIVOS\`: \`### Ortografía\`, \`### Gramática\`, \`### Puntuación\`, \`### Tipografía\`, \`### Léxico\`, \`### Estilo\`, aunque alguna subsección no tenga viñetas todavía.
</contrato>

<perfil>
Perfil documental actual:
~~~markdown
${input.currentProfileMarkdown}
~~~
</perfil>

<metricas>
${wordCountInstructions}</metricas>

<datos>
Sugerencias de corrección de esta sesión:
${JSON.stringify(input.suggestions, null, 2)}

Patrones encontrados limpios (evidencia positiva):
${JSON.stringify(input.cleanPatterns, null, 2)}
</datos>

<respuesta-final>
Devuelve el documento markdown completo actualizado y un change summary breve indicando agregados, podas o transiciones logradas, o explica por qué descartaste cambios si no corresponde actualizar.
</respuesta-final>`
}
