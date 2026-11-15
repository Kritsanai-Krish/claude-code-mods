import { expect, test } from 'claude-code/testing'
import { isPlainBackspace, peelLastMark } from './thai-marks'

/** A Backspace that would delete `text[start, end)` with the caret at `cursor`. */
function deletion(text: string, cursor: number, start: number, end: number) {
  return { text, cursor, start, end, inputText: '' }
}

test('removes only the tone mark from กี่', async () => {
  const text = 'ทดสอบกี่'
  const end = text.length
  expect(peelLastMark(deletion(text, end, end - 3, end))).toEqual({ text: 'ทดสอบกี', cursor: end - 1 })
})

test('removes only sara am from น้ำ, then the tone mark', async () => {
  expect(peelLastMark(deletion('น้ำ', 3, 0, 3))).toEqual({ text: 'น้', cursor: 2 })
  expect(peelLastMark(deletion('น้', 2, 0, 2))).toEqual({ text: 'น', cursor: 1 })
})

test('works in the middle of the draft', async () => {
  expect(peelLastMark(deletion('ก่อน', 2, 0, 2))).toEqual({ text: 'กอน', cursor: 1 })
})

test('Lao marks peel off the same way', async () => {
  expect(peelLastMark(deletion('ກີ່', 3, 0, 3))).toEqual({ text: 'ກີ', cursor: 2 })
  expect(peelLastMark(deletion('ນ້ຳ', 3, 0, 3))).toEqual({ text: 'ນ້', cursor: 2 })
})

test('leaves single characters and other scripts to the editor', async () => {
  expect(peelLastMark(deletion('ก', 1, 0, 1))).toBeUndefined()
  expect(peelLastMark(deletion('é', 2, 0, 2))).toBeUndefined()
  expect(peelLastMark(deletion('👍🏽', 4, 0, 4))).toBeUndefined()
})

test('leaves forward-style deletions (caret before the cluster) alone', async () => {
  expect(peelLastMark(deletion('กี่', 0, 0, 3))).toBeUndefined()
})

test('leaves a deletion of more than one cluster alone, even when it ends in a mark', async () => {
  // A kill-to-line-start or a word deletion: the person asked for all of it to go.
  expect(peelLastMark(deletion('กากี่', 5, 0, 5))).toBeUndefined()
  expect(peelLastMark(deletion('a กี่', 5, 0, 5))).toBeUndefined()
})

test('leaves a replacement alone: only a pure deletion is a Backspace', async () => {
  expect(peelLastMark({ text: 'กี่', cursor: 3, start: 0, end: 3, inputText: 'x' })).toBeUndefined()
})

test('offsets outside the draft are left to the editor', async () => {
  expect(peelLastMark(deletion('กี่', 9, 0, 9))).toBeUndefined()
  expect(peelLastMark(deletion('กี่', 3, -1, 3))).toBeUndefined()
})

test('Backspace, Shift+Backspace and Ctrl+H are a plain Backspace; word deletion is not', async () => {
  expect(isPlainBackspace({ key: 'backspace' })).toBe(true)
  expect(isPlainBackspace({ key: 'backspace', shift: true })).toBe(true)
  expect(isPlainBackspace({ key: 'h', ctrl: true })).toBe(true)
  expect(isPlainBackspace({ key: 'backspace', ctrl: true })).toBe(false)
  expect(isPlainBackspace({ key: 'backspace', meta: true })).toBe(false)
  expect(isPlainBackspace({ key: 'h' })).toBe(false)
  expect(isPlainBackspace({ key: 'delete' })).toBe(false)
  expect(isPlainBackspace(undefined)).toBe(false)
})
