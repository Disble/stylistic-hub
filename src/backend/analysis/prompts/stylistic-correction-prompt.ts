// Copied verbatim from stylistics-backend@8165af5 (src/mastra); keep the prompt text in sync.
/**
 * Shares the stable editorial prompt fragments reused by stylistic workflow
 * steps that emit the canonical structured correction payload.
 */
import { FICTION_EDITORIAL_FRAME, GENRE_RULES } from './prompt-sections'
import type { PromptGenre } from '../schemas'

/** Restores the compact prompt prelude that existed before prompt inflation. */
export function buildPromptIntroduction(genero: PromptGenre) {
  const sections: string[] = []

  if (genero === 'narrativa-literaria') {
    sections.push(FICTION_EDITORIAL_FRAME)
  }

  const genreRules = GENRE_RULES[genero]

  if (genreRules) {
    sections.push(genreRules)
  }

  return sections.length > 0 ? `${sections.join('\n\n')}\n\n` : ''
}

/** Keeps the resolved profile inline so the agent never needs extra reads. */
export function buildAuthorProfileSection(authorProfile?: string | null) {
  return authorProfile
    ? `<perfil-autor>
Usa este perfil como contexto de maxima prioridad y como checklist activo de patrones. NO uses herramientas para leer archivos en esta tarea; el perfil relevante ya esta incluido.

${authorProfile}
</perfil-autor>`
    : `<perfil-autor>
No hay perfil previo disponible para este autor. Corrige sin contexto previo y NO uses herramientas para leer archivos en esta tarea.
</perfil-autor>`
}
