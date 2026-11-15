// Session state: which pictures belong to which transcript row.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { PreviewEntry } from '../types'

// Enough for a long session; older rows just lose their preview.
const MAX_REMEMBERED_ROWS = 300

// Change the tag when PreviewEntry's fields change: it declines what an
// earlier version stored, which outlives a reload.
const previewsAtom = atom({ plugin: 'image-preview', key: 'previews' } as const, [], { shape: 'previews-1' })

/** Returns the pictures stored under a row's key. Reading subscribes the row, so it redraws when they arrive. */
export async function findPreview($: EngineInterface, key: string): Promise<PreviewEntry | undefined> {
  const previews = await read($, previewsAtom)
  return previews.find(preview => preview.key === key)
}

/** Returns the pictures of the newest prompt with this exact text. */
export async function findPromptPreviewByText($: EngineInterface, promptText: string): Promise<PreviewEntry | undefined> {
  const previews = await read($, previewsAtom)
  return previews.findLast(preview => preview.promptText === promptText)
}

/** Remembers a row's pictures (replacing any stored under the same key) and redraws the rows that read them. */
export async function rememberPreview($: EngineInterface, entry: PreviewEntry): Promise<void> {
  await update($, previewsAtom, previews => {
    const others = previews.filter(preview => preview.key !== entry.key)
    return [...others, entry].slice(-MAX_REMEMBERED_ROWS)
  })
}
