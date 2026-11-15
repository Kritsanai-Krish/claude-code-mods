import { expect, test } from 'claude-code/testing'
import { findPromptImages, findToolResultImages, messageKeyOf } from './blocks'

const PNG = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
const JPEG = { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBBB' } }

test('the pictures of a prompt are found in order, text blocks skipped', async () => {
  const content = [{ type: 'text', text: '[Image #1] look [Image #2]' }, PNG, JPEG]
  expect(findPromptImages(content)).toEqual([
    { mediaType: 'image/png', base64: 'AAAA' },
    { mediaType: 'image/jpeg', base64: 'BBBB' },
  ])
})

test('the pictures of tool results are grouped by the call they answer', async () => {
  const content = [
    { type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'done' }, PNG] },
    { type: 'tool_result', tool_use_id: 'toolu_2', content: 'plain text result' },
    { type: 'tool_result', tool_use_id: 'toolu_3', content: [JPEG, PNG] },
  ]
  expect(findToolResultImages(content)).toEqual([
    { toolUseId: 'toolu_1', images: [{ mediaType: 'image/png', base64: 'AAAA' }] },
    { toolUseId: 'toolu_3', images: [{ mediaType: 'image/jpeg', base64: 'BBBB' }, { mediaType: 'image/png', base64: 'AAAA' }] },
  ])
})

test('pictures the terminal should not be handed are left out', async () => {
  const svg = { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zz4=' } }
  const byUrl = { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }
  const empty = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }
  expect(findPromptImages([svg, byUrl, empty, null, 'text', { type: 'image' }])).toEqual([])
  expect(findPromptImages('just text')).toEqual([])
  expect(findToolResultImages(undefined)).toEqual([])
})

test('a transcript row and its stored message share the key their ids start with', async () => {
  expect(messageKeyOf('f94e7fd5-072b-46af-a4a1-d64ed6c0cd51')).toBe('f94e7fd5-072b-46af-a4a1')
  expect(messageKeyOf('f94e7fd5-072b-46af-a4a1-000000000000')).toBe('f94e7fd5-072b-46af-a4a1')
  expect(messageKeyOf('placeholder')).toBe(undefined)
  expect(messageKeyOf(undefined)).toBe(undefined)
})
