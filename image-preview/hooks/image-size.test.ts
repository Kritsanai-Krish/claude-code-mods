import { expect, test } from 'claude-code/testing'
import { decodedByteCount, fitImageToCells, parseSizeLine, previewColumnLimit } from './image-size'

test('a wide picture fills the column limit and keeps its shape', () => {
  // 1600x800 is 2:1; a cell is twice as tall as wide, so 72 columns -> 18 rows.
  expect(fitImageToCells(1600, 800, 72, 20)).toEqual({ columns: 72, rows: 18 })
})

test('a tall picture is capped by rows and narrowed to match', () => {
  // 600x1200: 72 columns would need 72 rows; 20 rows allow 20 columns.
  expect(fitImageToCells(600, 1200, 72, 20)).toEqual({ columns: 20, rows: 20 })
})

test('a small icon is not blown up', () => {
  // 32 px is about 4 columns wide.
  expect(fitImageToCells(32, 32, 72, 20)).toEqual({ columns: 4, rows: 2 })
})

test('a missing size falls back to the limits', () => {
  expect(fitImageToCells(0, 0, 40, 10)).toEqual({ columns: 40, rows: 10 })
})

test('the column limit leaves room for the indent on a narrow terminal', () => {
  expect(previewColumnLimit(50, 5)).toBe(45)
  expect(previewColumnLimit(200, 5)).toBe(72)
  expect(previewColumnLimit(undefined, 5)).toBe(72)
})

test('base64 length counts padding', () => {
  expect(decodedByteCount('QQ==')).toBe(1)
  expect(decodedByteCount('QUI=')).toBe(2)
  expect(decodedByteCount('QUJD')).toBe(3)
})

test('ImageMagick size line parses, junk does not', () => {
  expect(parseSizeLine('640 480')).toEqual({ widthPixels: 640, heightPixels: 480 })
  expect(parseSizeLine('magick: no decode delegate')).toBe(undefined)
})
