// Copied verbatim from stylistics-backend@8165af5 (src/mastra); keep the prompt text in sync.
/**
 * Builds the prompt used by the feedback workflow step.
 */
import type { ProcessFeedbackPromptInput } from '../schemas'

/** Builds the DB-backed prompt used when feedback targets a persisted document profile. */
export function buildProcessFeedbackPrompt(input: ProcessFeedbackPromptInput) {
  return `<contract>
Procesa UN comentario de feedback del autor sobre una corrección.
Usa el perfil documental provisto en este prompt como documento objetivo.
Ejecuta el protocolo completo: RAZONAR -> DECIDIR -> ACTUAR.
Aplica estrictamente la política de escritura segura de tu protocolo canónico.
Este prompt solo aporta perfil y payload; la sección objetivo, reglas de edición, política de borrado y criterios de aborto viven en tu protocolo canónico.
No inventes rutas, no menciones workspace y devuelve SOLO el output estructurado solicitado por el caller.
Preserva intacta la estructura canónica completa de \`## PATRONES VIVOS\`, incluyendo \`### Ortografía\`, \`### Gramática\`, \`### Puntuación\`, \`### Tipografía\`, \`### Léxico\` y \`### Estilo\`.
</contract>

<profile>
Perfil documental actual:
~~~markdown
${input.authorProfile}
~~~
</profile>

<payload>
${JSON.stringify(
  {
    category: input.category,
    context: input.context,
    anchor: input.anchor,
    suggestedText: input.suggestedText,
    justification: input.justification,
    action: input.action,
    severity: input.severity,
    suggestionType: input.suggestionType,
    comment: input.comment
  },
  null,
  2
)}
</payload>

<final-response>
Si devuelves status \`updated\`, DEBES devolver también el perfil markdown completo actualizado.
Si devuelves status \`ignored\`, explica la categoría asignada y la razón del descarte en un decision summary conciso.
</final-response>`
}
