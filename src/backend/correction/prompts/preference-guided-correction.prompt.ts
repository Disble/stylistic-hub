// Copied verbatim from stylistics-backend@8165af5 (src/mastra); keep the prompt text in sync.
/**
 * Builds the scoped prompt used by the preference-guided correction pre-step.
 */
import type { StylisticWorkflowInput } from '../schemas'
import { SUGGESTION_TYPES_SECTION } from './prompt-sections'
import { buildAuthorProfileSection, buildPromptIntroduction } from './stylistic-correction-prompt'

/** Restricts the pre-step to explicit user preferences instead of full editing. */
export function buildPreferenceGuidedCorrectionPrompt(
  input: StylisticWorkflowInput,
  authorProfile: string | null | undefined,
  correctionInstructions: string
) {
  const promptIntroduction = buildPromptIntroduction(input.genero)
  const authorProfileSection = buildAuthorProfileSection(authorProfile)

  return `${promptIntroduction}<contrato>
Esta tarea se enfoca UNICAMENTE en las preferencias explícitas del usuario.
No hagas una corrección integral del texto: limita tus hallazgos a lo que esté justificado directamente por esas preferencias y por evidencia textual concreta.
Si una preferencia no aplica a este fragmento o no hay evidencia suficiente, no inventes hallazgos: devuelve arrays vacíos o solo las sugerencias realmente sustentadas.
Usa las instrucciones del agente como protocolo canónico y este prompt solo como payload de ejecución.
No leas archivos ni busques perfiles por tu cuenta durante esta tarea.
</contrato>

${SUGGESTION_TYPES_SECTION}

<preferencias-usuario>
${correctionInstructions}
</preferencias-usuario>

<criterio-operativo>
- Audita exclusivamente los focos marcados por el usuario.
- Justifica cada intervención mencionando la preferencia aplicada y la evidencia textual concreta.
- Si el perfil autoral o el género entran en tensión con la preferencia, ajusta solo el defecto señalado sin convertir esta tarea en una reescritura global.
- No agregues sugerencias por criterio editorial general si no derivan de las preferencias explícitas del usuario.
</criterio-operativo>

${authorProfileSection}

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
