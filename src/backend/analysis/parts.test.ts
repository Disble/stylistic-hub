import { describe, expect, it } from 'vitest'
import type { WorkflowSuggestion } from './schemas'
import { placeable, splitIntoParts } from './parts'

describe('splitIntoParts', () => {
  it('keeps an empty chunk as one empty part', () => {
    expect(splitIntoParts('')).toEqual([''])
  })

  it('keeps a chunk that fits as one part', () => {
    expect(splitIntoParts('Uno.\nDos.', 100)).toEqual(['Uno.\nDos.'])
  })

  it('splits at paragraph ends, packing paragraphs up to the limit', () => {
    const text = ['aaaa', 'bbbb', 'cccc', 'dddd'].join('\n')

    expect(splitIntoParts(text, 10)).toEqual(['aaaa\nbbbb\n', 'cccc\ndddd'])
  })

  it('never splits a paragraph, even one longer than the limit', () => {
    const text = `corto\n${'x'.repeat(30)}\nfin`

    expect(splitIntoParts(text, 10)).toEqual(['corto\n', `${'x'.repeat(30)}\n`, 'fin'])
  })

  it('loses no character, so every suggestion context stays inside one part', () => {
    const text = 'Primero.\n\nSegundo párrafo.\r\nTercero.\n'

    expect(splitIntoParts(text, 12).join('')).toBe(text)
  })
})

/** A suggestion with the given anchor and context. */
function suggestion(
  context: string,
  anchor: string,
  extra: Partial<WorkflowSuggestion> = {}
): WorkflowSuggestion {
  return {
    context,
    anchor,
    justification: 'j',
    category: 'estilo',
    severity: 'low',
    type: 'comment-only',
    ...extra
  } as WorkflowSuggestion
}

describe('placeable', () => {
  it('keeps suggestions whose anchor is inside their context', () => {
    const ok = suggestion('ni persona mayores que', 'persona mayores')

    expect(placeable([ok])).toEqual({ suggestions: [ok], dropped: 0 })
  })

  it('drops and counts suggestions whose anchor the add-in could not find in their context', () => {
    const ok = suggestion('fue atrapada', 'atrapada')
    const lost = suggestion('fue atrapada', 'capturada')
    const empty = suggestion('fue atrapada', '')

    expect(placeable([lost, ok, empty])).toEqual({ suggestions: [ok], dropped: 2 })
  })

  it('drops and counts what the add-in rejects: a blank anchor, context or justification', () => {
    const ok = suggestion('palabra  palabra', 'palabra')
    const blankAnchor = suggestion('palabra  palabra', '  ', { type: 'track-change', suggestedText: ' ' })
    const blankJustification = suggestion('fue atrapada', 'atrapada', { justification: ' ' })
    const blankContext = suggestion(' ', ' ')

    expect(placeable([blankAnchor, ok, blankJustification, blankContext])).toEqual({
      suggestions: [ok],
      dropped: 3
    })
  })
})
