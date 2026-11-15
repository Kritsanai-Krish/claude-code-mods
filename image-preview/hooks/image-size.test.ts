import { expect, test } from 'claude-code/testing'
import { decodedByteCount, fitImageToCells, layoutGallery, parseSizeLine, previewColumnLimit, readPngSize, SIZE_LIMITS } from './image-size'

const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('a wide picture fills the column limit and keeps its shape', async () => {
  expect(fitImageToCells(1600, 800, 72, 20)).toEqual({ columns: 72, rows: 18 })
})

test('a tall picture is capped by rows and narrowed to match', async () => {
  expect(fitImageToCells(800, 1600, 72, 20)).toEqual({ columns: 20, rows: 20 })
})

test('a small icon is not blown up', async () => {
  expect(fitImageToCells(32, 32, 72, 20)).toEqual({ columns: 4, rows: 2 })
})

test('a missing size falls back to the limits', async () => {
  expect(fitImageToCells(0, 0, 72, 20)).toEqual({ columns: 72, rows: 20 })
})

test('the column limit leaves room for the indent on a narrow terminal', async () => {
  expect(previewColumnLimit(40, 5, 72)).toBe(35)
  expect(previewColumnLimit(200, 5, 72)).toBe(72)
  expect(previewColumnLimit(undefined, 5, 72)).toBe(72)
  expect(previewColumnLimit(3, 5, 72)).toBe(1)
})

test('base64 length counts padding', async () => {
  expect(decodedByteCount('QUJD')).toBe(3)
  expect(decodedByteCount('QUI=')).toBe(2)
  expect(decodedByteCount('QQ==')).toBe(1)
})

test('ImageMagick size line parses, junk does not', async () => {
  expect(parseSizeLine('640 480\n')).toEqual({ widthPixels: 640, heightPixels: 480 })
  expect(parseSizeLine('magick: no decode delegate')).toBeUndefined()
})

test('a PNG says its own size in its header', async () => {
  expect(readPngSize(ONE_PIXEL_PNG)).toEqual({ widthPixels: 1, heightPixels: 1 })
  expect(readPngSize('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQE')).toBeUndefined()
  expect(readPngSize('iVBORw0K')).toBeUndefined()
  expect(readPngSize('not base64 at all !!!')).toBeUndefined()
})

test('one picture gets the full size; several share the width as thumbnails', async () => {
  const wide = { widthPixels: 1600, heightPixels: 800 }
  const limits = SIZE_LIMITS.medium
  expect(layoutGallery([wide], 100, limits)).toEqual([[{ columns: 72, rows: 18 }]])
  // Two side by side, each at most half the width (less the gap) and the thumbnail height.
  expect(layoutGallery([wide, wide], 100, limits)).toEqual([[{ columns: 40, rows: 10 }, { columns: 40, rows: 10 }]])
})

test('more pictures than fit in a row wrap onto the next', async () => {
  const square = { widthPixels: 400, heightPixels: 400 }
  const rows = layoutGallery([square, square, square, square, square], 100, SIZE_LIMITS.medium)
  expect(rows.map(row => row.length)).toEqual([4, 1])
  expect(rows[0]?.[0]).toEqual({ columns: 20, rows: 10 })
})

test('a narrow terminal still shows every picture, one per row if it must', async () => {
  const square = { widthPixels: 400, heightPixels: 400 }
  const rows = layoutGallery([square, square], 12, SIZE_LIMITS.medium)
  expect(rows.map(row => row.length)).toEqual([1, 1])
})
