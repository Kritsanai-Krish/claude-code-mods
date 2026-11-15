/**
 * Thai characters that join the consonant before them into one grapheme
 * cluster. The editor deletes a whole cluster on Backspace, so these are the
 * characters we peel off one at a time instead.
 *
 * U+0E31        ั  mai han-akat
 * U+0E33        ำ  sara am (a spacing mark, but still part of the cluster)
 * U+0E34–U+0E3A ิ ี ึ ื ุ ู ฺ  upper/lower vowels and phinthu
 * U+0E47–U+0E4E ็ ่ ้ ๊ ๋ ์ ํ ๎  maitaikhu, tone marks, thanthakhat, ...
 */
const THAI_JOINING_MARK = /[ัำ-ฺ็-๎]/

export type PromptState = { text: string; cursor: number }

/** Returns true when the character is a Thai vowel or tone mark that joins the previous consonant. */
export function isThaiJoiningMark(character: string): boolean {
  return THAI_JOINING_MARK.test(character)
}

/**
 * Decides what a Backspace that would delete `text[start, end)` should do.
 *
 * Returns the prompt with only the last Thai mark removed when the span is a
 * multi-character cluster ending in such a mark and the caret sits at its end;
 * returns undefined to let the editor delete normally.
 */
export function deleteLastThaiMark(text: string, cursor: number, start: number, end: number): PromptState | undefined {
  const isWholeClusterDeletion = end - start > 1
  if (!isWholeClusterDeletion) {
    return undefined
  }
  const isCaretAtClusterEnd = cursor === end
  if (!isCaretAtClusterEnd) {
    return undefined
  }
  const lastCharacter = text.charAt(end - 1)
  if (!isThaiJoiningMark(lastCharacter)) {
    return undefined
  }
  // Thai marks are all in the BMP, so one mark is exactly one UTF-16 code unit.
  const newText = text.slice(0, end - 1) + text.slice(end)
  return { text: newText, cursor: end - 1 }
}
