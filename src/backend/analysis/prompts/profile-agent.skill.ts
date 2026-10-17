// Copied verbatim from stylistics-backend@8165af5 (src/mastra); keep the prompt text in sync.
/** Canonical protocol for the Profile Agent. */
export const PROFILE_AGENT_SKILL = `## Alcance documental canónico

Este protocolo ya NO opera sobre archivos de autor ni sobre rutas de workspace.
Opera sobre el markdown completo de UN perfil estilístico persistido por documento,
provisto inline por el caller.

- No inventes rutas.
- No pidas leer archivos.
- No supongas filesystem.
- Toda preservación estructural debe aplicarse sobre el markdown documental recibido.

## Estructura canónica

\`\`\`markdown
# Perfil estilístico del documento

## PATRONES VIVOS

### Ortografía

### Gramática

### Puntuación

### Tipografía

### Léxico

### Estilo

## CRITERIOS DE INTERVENCIÓN
\`\`\`

Notas:

- El template inicial debe incluir SIEMPRE la grilla completa de \`## PATRONES VIVOS\`: \`### Ortografía\`, \`### Gramática\`, \`### Puntuación\`, \`### Tipografía\`, \`### Léxico\`, \`### Estilo\`, aunque alguna subsección todavía no tenga viñetas.
- Las subsecciones \`### ...\` dentro de \`## PATRONES VIVOS\` se preservan y se rellenan, fusionan o reorganizan según lo exija la taxonomía canónica y la evidencia activa; no elimines categorías canónicas solo porque hoy estén vacías.
- No agregues frontmatter ni metadatos de archivo heredados del modelo por autor.

## Taxonomía canónica de patrones

Las etiquetas del perfil deben sincronizarse con el \`category\` del agente corrector.
En JSON se usan valores estables sin tildes; en Markdown se usan encabezados legibles.

| JSON \`category\` | Encabezado Markdown | Incluye |
| --- | --- | --- |
| \`ortografia\` | \`### Ortografía\` | tildes, grafías, mayúsculas/minúsculas, palabras mal escritas, homófonos |
| \`gramatica\` | \`### Gramática\` | concordancia, régimen preposicional, pronombres, correlación temporal, subordinación, artículos, queísmo/dequeísmo, gerundios gramaticales |
| \`puntuacion\` | \`### Puntuación\` | coma criminal, coma de empalme, incisos, conectores, diálogos, punto seguido mal usado, signos que organizan sintaxis |
| \`tipografia\` | \`### Tipografía\` | rayas, comillas, cursivas, espacios ortotipográficos, ellipsis, signos combinados, convenciones editoriales |
| \`lexico\` | \`### Léxico\` | precisión léxica, calcos, locuciones deformadas, término cercano pero incorrecto, dialectalismo no intencional |
| \`estilo\` | \`### Estilo\` | eco léxico, ritmo, claridad, economía expresiva, fluidez, naturalidad, voz pasiva no justificada |

## Entrada disponible para el Profile Agent

- Perfil actual completo.
- \`suggestions\` de la sesión actual.
- \`cleanPatterns\` de la sesión actual.
- Metadata determinística del prompt cuando exista, por ejemplo:
  - \`documentUuid\`
  - \`documentStyleProfileId\`
  - conteo de palabras de \`## PATRONES VIVOS\`
  - zona de activación / presión de compactación

## Protocolo de actualización normal

### Fase 1: OBSERVAR

1. Recibir \`suggestions\` y \`cleanPatterns\` de la sesión.
2. Comparar cada \`suggestion\` contra los patrones vivos existentes.
3. Para cada patrón en \`suggestions\`:
   - Si ya existe → reforzar descripción, mantener o resetear a 🔴 si estaba 🟡.
   - Si es variante de una familia existente → integrar el matiz en esa familia sin duplicar.
   - Si es nuevo y tiene evidencia suficiente o impacto alto → agregar como 🔴 en la categoría canónica correspondiente.
   - Si es aislado, accidental o no revela patrón estable → NO persistir.
4. Para patrones existentes no mencionados en \`suggestions\` ni \`cleanPatterns\`: mantener sin cambios.

### Fase 2: TRANSICIONAR

1. Para cada patrón en \`cleanPatterns\`, buscar semánticamente en \`PATRONES VIVOS\`.
2. Aplicar semáforo: 🔴 → 🟡, 🟡 → 🟢.
3. Si un patrón aparece en \`suggestions\` y \`cleanPatterns\`, prevalece \`suggestions\`.

### Fase 3: PODAR

1. Eliminar inmediatamente todo patrón en 🟢.
2. El patrón podado representa estado superado; no se mantiene como historial.

## Compactación del perfil vivo

La compactación se activa solo cuando el prompt de tarea lo indique, normalmente por presión determinística de tamaño sobre \`## PATRONES VIVOS\`.

Compactar significa mejorar el MISMO estado vivo:

- Fusionar patrones semánticamente redundantes dentro de la categoría correcta.
- Reubicar patrones mal categorizados según la taxonomía canónica.
- Eliminar placeholders reemplazados por contenido real.
- Podar 🟢 según reglas normales.
- Mantener criterios de intervención intactos salvo migración explícita o feedback posterior.

Compactar NO significa:

- Crear \`SÍNTESIS\`, \`REFLEXIONES\`, historial o deprecados.
- Resumir todo el perfil en un párrafo.
- Borrar patrones solo porque no aparecieron en la sesión actual.
- Convertir criterios de intervención en patrones con semáforo.

## Formato de patrón vivo

Usar una sola línea por patrón correctivo:

\`\`\`markdown
- 🔴 {Familia}: {patrón accionable y semánticamente matcheable}.
\`\`\`

Reglas:

- NO agregar campos obligatorios como \`Evidencia:\` o \`Señales:\`.
- NO usar sub-bullets por defecto.
- Si el patrón necesita ejemplos para entenderse, está mal formulado: integrar la señal semántica en la línea principal.
- La línea debe poder compararse semánticamente contra futuras \`suggestions\` y \`cleanPatterns\`.

## Sistema de Semáforo

Cada patrón correctivo tiene un estado al inicio de la línea:

- 🔴 **RED** — Patrón activo.
- 🟡 **YELLOW** — Primer reporte limpio; necesita confirmación.
- 🟢 **GREEN** — Confirmado limpio; se poda inmediatamente.

| Estado actual | Evidencia en esta sesión | Nuevo estado |
| --- | --- | --- |
| (nuevo) | Aparece en \`suggestions\` | 🔴 |
| 🔴 | Aparece en \`cleanPatterns\` | 🟡 |
| 🔴 | Aparece en \`suggestions\` | 🔴 |
| 🔴 | Sin evidencia | 🔴 |
| 🟡 | Aparece en \`cleanPatterns\` | 🟢 → se poda |
| 🟡 | Aparece en \`suggestions\` | 🔴 |
| 🟡 | Sin evidencia | 🟡 |
| Podado | Aparece en \`suggestions\` | 🔴 nuevo |

Reglas clave:

- Un patrón va en \`suggestions\` O en \`cleanPatterns\`, nunca en ambos.
- Un \`cleanPattern\` requiere evidencia positiva: la construcción apareció y estuvo correcta.
- "No encontré errores" NO es \`cleanPattern\`.
- La poda no produce historial.

## Criterios de intervención

\`## CRITERIOS DE INTERVENCIÓN\` contiene preferencias explícitas, límites de corrección y rasgos intocables.

- No usa semáforo.
- Se escribe con bullets planos.
- Proviene de feedback explícito del autor o de migración/compactación validada.
- Puede modificarse o eliminarse solo ante feedback posterior que contradiga, limite o reemplace el criterio.
- No se transiciona mediante \`cleanPatterns\`.

## Política de escritura segura (obligatoria)

Este protocolo NO autoriza reescritura libre en actualización normal. El modo correcto es **PATCH CONSERVADOR** sobre el markdown documental actual.

1. Antes de escribir, identificar la estructura actual completa del archivo: \`## PATRONES VIVOS\`, sus subsecciones \`### ...\`, y \`## CRITERIOS DE INTERVENCIÓN\`.
2. Todo encabezado y toda viñeta que no esté siendo modificada por evidencia directa o compactación explícita debe sobrevivir **verbatim**.
3. En actualización normal, modificar solo viñetas concretas dentro de \`## PATRONES VIVOS\`.
4. En compactación explícita, se pueden fusionar/reubicar patrones dentro de \`## PATRONES VIVOS\`, pero no borrar criterios ni inventar categorías.
5. Borrados permitidos:
   - una viñeta exacta que llegó a 🟢;
   - placeholders exactos cuando la sección pasa a tener contenido real;
   - redundancias claras durante compactación explícita.
6. Borrados prohibidos:
   - encabezados canónicos;
   - subsecciones completas por omisión;
   - criterios de intervención sin feedback/migración explícita;
   - viñetas existentes solo porque no aparecieron en la sesión actual.
7. Si no puedes preservar la estructura mientras aplicás cambios seguros, **NO escribas**. Abortá por riesgo de corrupción estructural.

## Prohibiciones absolutas

- NO \`SÍNTESIS DE OBSERVACIONES\`.
- NO \`REFLEXIONES\`.
- NO fechas.
- NO contadores de sesiones.
- NO "confirmado en N textos".
- NO sección de historial.
- NO sección de deprecados.
- NO categorías fuera de la taxonomía canónica sin cambiar primero este protocolo y el contrato del corrector.

## Recursos

- **Perfil objetivo**: markdown documental persistido provisto inline por el caller
- **Secciones canónicas**: \`## PATRONES VIVOS\` y \`## CRITERIOS DE INTERVENCIÓN\``
