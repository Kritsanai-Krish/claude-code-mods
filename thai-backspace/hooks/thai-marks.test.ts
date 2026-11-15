import { expect, test } from 'claude-code/testing'
import { deleteLastThaiMark } from './thai-marks'

test('removes only the tone mark from กี่', async () => {
  const text = 'ทดสอบกี่'
  const end = text.length
  expect(deleteLastThaiMark(text, end, end - 3, end)).toEqual({ text: 'ทดสอบกี', cursor: end - 1 })
})

test('removes only sara am from น้ำ, then the tone mark', async () => {
  expect(deleteLastThaiMark('น้ำ', 3, 0, 3)).toEqual({ text: 'น้', cursor: 2 })
  expect(deleteLastThaiMark('น้', 2, 0, 2)).toEqual({ text: 'น', cursor: 1 })
})

test('works in the middle of the draft', async () => {
  expect(deleteLastThaiMark('ก่อน', 2, 0, 2)).toEqual({ text: 'กอน', cursor: 1 })
})

test('leaves single characters and non-Thai text to the editor', async () => {
  expect(deleteLastThaiMark('ก', 1, 0, 1)).toBeUndefined()
  expect(deleteLastThaiMark('é', 2, 0, 2)).toBeUndefined()
  expect(deleteLastThaiMark('👍🏽', 4, 0, 4)).toBeUndefined()
})

test('leaves forward-style deletions (caret before the cluster) alone', async () => {
  expect(deleteLastThaiMark('กี่', 0, 0, 3)).toBeUndefined()
})
