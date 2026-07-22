import type { Capture, PaperMeta } from '../types'

// Builds the consistent, paste-into-Claude document. The app deliberately does
// NOT try to be smart here — it produces a clean, predictable structure so the
// user's Claude Project can do the synthesis against their existing lit review.
export function buildNotesDoc(meta: PaperMeta, captures: Capture[]): string {
  const done = captures.filter((c) => c.status !== 'error')
  const lines: string[] = []

  lines.push(`# Reading notes: ${meta.title || 'Untitled paper'}`)
  if (meta.authors) lines.push(`**Authors:** ${meta.authors}`)
  lines.push('')
  lines.push(
    `_${done.length} voice ${done.length === 1 ? 'note' : 'notes'} captured while reading._`,
  )
  lines.push('')

  lines.push('## Captured notes')
  lines.push('')
  done.forEach((c, i) => {
    lines.push(`### ${i + 1}.`)
    if (c.anchorText) {
      lines.push(`> **From the paper:** ${c.anchorText}`)
    }
    lines.push(`**My note:** ${c.transcript || '(empty)'}`)
    lines.push('')
  })

  lines.push('---')
  lines.push('')
  lines.push('## For Claude')
  lines.push(
    'These are raw voice notes I took while reading the paper above. Please:',
  )
  lines.push('1. Clean up each note (fix transcription errors, keep my meaning).')
  lines.push(
    '2. Separate direct quotes from the paper vs. my own reactions/thoughts.',
  )
  lines.push('3. Pull out any open questions I raised.')
  lines.push(
    '4. Then compare against my existing literature review in this Project: where does this paper agree, disagree, or add something new?',
  )

  return lines.join('\n')
}
