import type { Register } from 'claude-code'
import { isPlainBackspace, peelLastMark } from './thai-marks'

/**
 * Makes Backspace in the prompt box remove one Thai or Lao vowel or tone mark
 * at a time (กี่ → กี → ก), instead of the whole consonant-plus-marks cluster.
 */
export const register: Register = on => {
  on('prompt.edit', async ($, e, next) => {
    if (!isPlainBackspace(e.key)) {
      return next(e)
    }
    const smallerDeletion = peelLastMark(e)
    if (smallerDeletion === undefined) {
      return next(e)
    }
    return smallerDeletion
  })
}
