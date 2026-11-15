/**
 * Thai and Lao characters that join the consonant before them into one
 * grapheme cluster. The editor deletes a whole cluster on Backspace, so these
 * are the characters peeled off one at a time instead.
 *
 * Thai
 *   U+0E31        ั  mai han-akat
 *   U+0E33        ำ  sara am (a spacing mark, but still part of the cluster)
 *   U+0E34–U+0E3A ิ ี ึ ื ุ ู ฺ  upper/lower vowels and phinthu
 *   U+0E47–U+0E4E ็ ่ ้ ๊ ๋ ์ ํ ๎  maitaikhu, tone marks, thanthakhat, ...
 * Lao (the same layout, one block later)
 *   U+0EB1, U+0EB3, U+0EB4–U+0EBC, U+0EC8–U+0ECE
 */
const JOINING_MARK = /[ัำ-ฺ็-๎ັຳ-ຼ່-໎]/

/** The prompt box after an edit. */
export type PromptState = { text: string; cursor: number }

/** One edit of the prompt box: the draft, the caret, the span replaced and what replaces it. */
export type PromptEdit = { text: string; cursor: number; start: number; end: number; inputText: string }

/** The key behind an edit, as the engine reports it. */
export type PressedKey = { key: string; ctrl?: true; shift?: true; meta?: true }

/** Returns true when the character is a Thai or Lao vowel or tone mark that joins the previous consonant. */
export function isJoiningMark(character: string): boolean {
  return JOINING_MARK.test(character)
}

/**
 * Returns true for the keys that delete one character backwards: Backspace
 * (with or without Shift) and Ctrl+H, the same key on terminals that send it
 * that way. Ctrl+Backspace and Alt+Backspace delete a word and are left alone.
 */
export function isPlainBackspace(key: PressedKey | undefined): boolean {
  if (key === undefined || key.meta === true) {
    return false
  }
  if (key.key === 'backspace') {
    return key.ctrl !== true
  }
  return key.key === 'h' && key.ctrl === true
}

/** True when `text[start, end)` is one cluster: a base character followed only by joining marks. */
function isSingleCluster(text: string, start: number, end: number): boolean {
  for (let index = start + 1; index < end; index += 1) {
    if (!isJoiningMark(text.charAt(index))) {
      return false
    }
  }
  return true
}

/**
 * Decides what a Backspace that would delete `text[start, end)` should do.
 *
 * Returns the prompt with only the last mark removed when the edit deletes
 * one multi-character cluster ending in a joining mark, with the caret at its
 * end; returns undefined to let the editor delete normally.
 */
export function peelLastMark(edit: PromptEdit): PromptState | undefined {
  const { text, cursor, start, end, inputText } = edit
  const isInsideDraft = start >= 0 && end <= text.length
  const isPureDeletion = inputText === ''
  const isWholeClusterDeletion = end - start > 1
  const isCaretAtClusterEnd = cursor === end
  if (!isInsideDraft || !isPureDeletion || !isWholeClusterDeletion || !isCaretAtClusterEnd) {
    return undefined
  }
  if (!isSingleCluster(text, start, end)) {
    return undefined
  }
  // Every joining mark is in the BMP, so one mark is exactly one UTF-16 code unit.
  const newText = text.slice(0, end - 1) + text.slice(end)
  return { text: newText, cursor: end - 1 }
}
