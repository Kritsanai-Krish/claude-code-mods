import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptEditInput, PromptEditResult } from 'claude-code'

/** Stands in for the editor: applies the splice as the engine would. */
function answerAsEditor(on: On): void {
  on('prompt.edit', (_, e) => ({
    text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end),
    cursor: e.start + e.inputText.length,
  }))
}

const ORIGIN = { kind: 'composer' } as const

/** Raises `prompt.edit` as the editor does. The kit runs it; its typings list only the calls a plugin can make. */
function edit($: Engine, input: PromptEditInput): Promise<PromptEditResult> {
  const prompt = $.prompt as unknown as { edit: (input: PromptEditInput) => Promise<PromptEditResult> }
  return prompt.edit(input)
}

test('Backspace after กี่ removes the tone mark only', async ($, on) => {
  answerAsEditor(on)
  const box = await edit($, { origin: ORIGIN, key: { key: 'backspace' }, text: 'กี่', cursor: 3, start: 0, end: 3, inputText: '' })
  expect([box.text, box.cursor]).toEqual(['กี', 2])
})

test('Ctrl+Backspace still deletes what the editor chose', async ($, on) => {
  answerAsEditor(on)
  const box = await edit($, { origin: ORIGIN, key: { key: 'backspace', ctrl: true }, text: 'กี่', cursor: 3, start: 0, end: 3, inputText: '' })
  expect([box.text, box.cursor]).toEqual(['', 0])
})

test('typing and pasting pass through untouched', async ($, on) => {
  answerAsEditor(on)
  const typed = await edit($, { origin: ORIGIN, key: { key: 'ก' }, text: 'กี่', cursor: 3, start: 3, end: 3, inputText: 'ก' })
  expect([typed.text, typed.cursor]).toEqual(['กี่ก', 4])
  const pasted = await edit($, { origin: ORIGIN, text: '', cursor: 0, start: 0, end: 0, inputText: 'น้ำ' })
  expect([pasted.text, pasted.cursor]).toEqual(['น้ำ', 3])
})
