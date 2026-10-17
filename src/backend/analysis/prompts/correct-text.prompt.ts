// Copied verbatim from stylistics-backend@8165af5 (src/mastra); keep the prompt text in sync.
/**
 * Builds the author-aware correction prompt used by the stylistic step.
 */
import type { StylisticWorkflowInput, StylisticWorkflowOutput } from '../schemas'
import { SUGGESTION_TYPES_SECTION } from './prompt-sections'
import { buildAuthorProfileSection, buildPromptIntroduction } from './stylistic-correction-prompt'

/** The preference pass's findings, offered to the integrated correction as input. */
function buildPreviousCorrectionSection(previousCorrection?: StylisticWorkflowOutput | null) {
  if (!previousCorrection) {
    return ''
  }

  return `<correcion-previa>
Considera este material como insumo editorial enfocado en preferencias explícitas del usuario. Puedes aceptar, refinar, combinar o descartar estos hallazgos según la evidencia del texto, el género y el perfil autoral. NO copies mecánicamente estas sugerencias; intégralas solo cuando mejoren la corrección final.

<suggestions>
${JSON.stringify(previousCorrection.suggestions, null, 2)}
</suggestions>

<clean-patterns>
${JSON.stringify(previousCorrection.cleanPatterns, null, 2)}
</clean-patterns>
</correcion-previa>`
}

/**
 * Builds the correction prompt from workflow input while keeping the genre-
 * specific editorial framing in one place.
 */
export function buildPrompt(
  input: StylisticWorkflowInput,
  authorProfile?: string | null,
  previousCorrection?: StylisticWorkflowOutput | null
) {
  const promptIntroduction = buildPromptIntroduction(input.genero)
  const authorProfileSection = buildAuthorProfileSection(authorProfile)
  const correctionInstruction =
    'Aplica correccion ortotipografica y de estilo integrada respetando la voz autoral y usando el perfil provisto solo si aparece en este prompt.'
  const previousCorrectionSection = buildPreviousCorrectionSection(previousCorrection)

  return `${promptIntroduction}<contrato>
${correctionInstruction}
No leas archivos ni busques perfiles por tu cuenta durante esta tarea.
Usa las instrucciones del agente como protocolo canónico y este prompt solo como payload de ejecución.
</contrato>

${SUGGESTION_TYPES_SECTION}

${previousCorrectionSection ? `${previousCorrectionSection}\n\n` : ''}${authorProfileSection}

<genero>
${input.genero}
</genero>

<texto-corregir>
${input.text}
</texto-corregir>

<respuesta-final>
Devuelve únicamente la salida estructurada solicitada por el workflow.
</respuesta-final>`
}
