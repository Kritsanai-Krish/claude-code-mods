import type { Register } from 'claude-code'
import { deleteLastThaiMark } from './thai-marks'

/**
 * Makes Backspace in the prompt box remove one Thai vowel or tone mark at a
 * time (กี่ → กี → ก), instead of the whole consonant-plus-marks cluster.
 */
export const register: Register = (on) => {
  on('prompt.edit', async ($, e, next) => {
    const isBackspace = e.key?.key === 'backspace' && !e.key.ctrl && !e.key.meta
    if (!isBackspace) {
      return next(e)
    }
    const smallerDeletion = deleteLastThaiMark(e.text, e.cursor, e.start, e.end)
    if (smallerDeletion === undefined) {
      return next(e)
    }
    return smallerDeletion
  })
}
