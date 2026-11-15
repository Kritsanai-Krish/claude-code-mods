// Session state: which pictures belong to which submitted prompt.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { PromptPreview } from '../types'

// Enough for a long session; older prompts just lose their preview.
const MAX_REMEMBERED_PROMPTS = 50

// Change the tag when PromptPreview's fields change: it declines what an
// earlier version stored, which outlives a reload.
const promptPreviews = atom({ plugin: 'image-preview', key: 'prompt-previews' } as const, [], {
  shape: 'prompt-previews-1',
})

/** Returns the pictures stored for a prompt's text, newest match first. */
export async function findPromptPreview(
  $: EngineInterface,
  promptText: string,
): Promise<PromptPreview | undefined> {
  const previews = await read($, promptPreviews)
  return previews.findLast(preview => preview.promptText === promptText)
}

/** Remembers the pictures of a submitted prompt (redraws the rows that read it). */
export async function rememberPromptPreview($: EngineInterface, preview: PromptPreview): Promise<void> {
  await update($, promptPreviews, previews => [...previews, preview].slice(-MAX_REMEMBERED_PROMPTS))
}
