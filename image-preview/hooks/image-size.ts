// How big a picture is drawn, in terminal cells. Pure functions, no `$`.

// A terminal cell is about twice as tall as it is wide (JetBrains Mono and
// most monospace fonts sit between 1.9 and 2.2), so one row covers the height
// of two columns.
export const CELL_HEIGHT_TO_WIDTH = 2

// Rough width of one cell in image pixels at normal scaling. Used only so a
// small icon is not blown up to fill the whole transcript.
const PIXELS_PER_COLUMN = 8

// The Image element takes 1 to 255 cells on each side.
const MAX_CELLS = 255

/** The largest a picture is drawn: alone, and as one of several side by side. */
export type SizeLimits = { maxColumns: number; maxRows: number; thumbnailColumns: number; thumbnailRows: number }

/** The three sizes the `size` option offers. */
export const SIZE_LIMITS: Record<'small' | 'medium' | 'large', SizeLimits> = {
  small: { maxColumns: 48, maxRows: 12, thumbnailColumns: 28, thumbnailRows: 7 },
  medium: { maxColumns: 72, maxRows: 20, thumbnailColumns: 40, thumbnailRows: 10 },
  large: { maxColumns: 110, maxRows: 32, thumbnailColumns: 56, thumbnailRows: 16 },
}

export type CellBox = { columns: number; rows: number }
export type PixelSize = { widthPixels: number; heightPixels: number }

function clampCells(cells: number): number {
  return Math.min(MAX_CELLS, Math.max(1, Math.round(cells)))
}

/**
 * Returns the largest cell box that keeps the picture's shape and fits inside
 * `maxColumns` x `maxRows`, never wider than the picture's own pixels allow.
 */
export function fitImageToCells(
  widthPixels: number,
  heightPixels: number,
  maxColumns: number,
  maxRows: number,
): CellBox {
  if (widthPixels <= 0 || heightPixels <= 0) {
    return { columns: clampCells(maxColumns), rows: clampCells(maxRows) }
  }
  const naturalColumns = Math.ceil(widthPixels / PIXELS_PER_COLUMN)
  const heightPerWidth = heightPixels / widthPixels

  let columns = Math.min(maxColumns, naturalColumns)
  let rows = (columns * heightPerWidth) / CELL_HEIGHT_TO_WIDTH
  if (rows > maxRows) {
    rows = maxRows
    columns = (rows * CELL_HEIGHT_TO_WIDTH) / heightPerWidth
  }
  return { columns: clampCells(columns), rows: clampCells(rows) }
}

/** Returns how many columns a preview may use in a transcript this wide. */
export function previewColumnLimit(viewportColumns: number | undefined, indent: number, maxColumns: number): number {
  const available = (viewportColumns ?? maxColumns + indent) - indent
  return Math.max(1, Math.min(maxColumns, available))
}

/** Cells left empty between two pictures in a row. */
export const GALLERY_GAP_CELLS = 2
const MAX_PICTURES_PER_ROW = 4
// Narrower than this a thumbnail shows nothing useful; fewer go in a row instead.
const MIN_THUMBNAIL_COLUMNS = 8

/**
 * Lays several pictures out as rows of thumbnails that fit `availableColumns`;
 * a single picture gets the full size. Returns one cell box per picture, row
 * by row, in the order given.
 */
export function layoutGallery(images: readonly PixelSize[], availableColumns: number, limits: SizeLimits): CellBox[][] {
  if (images.length <= 1) {
    const maxColumns = Math.min(limits.maxColumns, Math.max(1, availableColumns))
    return images.map(image => [fitImageToCells(image.widthPixels, image.heightPixels, maxColumns, limits.maxRows)])
  }
  let picturesPerRow = Math.min(images.length, MAX_PICTURES_PER_ROW)
  let slotColumns = slotWidth(availableColumns, picturesPerRow)
  while (picturesPerRow > 1 && slotColumns < MIN_THUMBNAIL_COLUMNS) {
    picturesPerRow -= 1
    slotColumns = slotWidth(availableColumns, picturesPerRow)
  }
  const thumbnailColumns = Math.max(1, Math.min(limits.thumbnailColumns, slotColumns))
  const rows: CellBox[][] = []
  for (let index = 0; index < images.length; index += picturesPerRow) {
    const rowImages = images.slice(index, index + picturesPerRow)
    rows.push(rowImages.map(image => fitImageToCells(image.widthPixels, image.heightPixels, thumbnailColumns, limits.thumbnailRows)))
  }
  return rows
}

/** The width each of `count` pictures gets when they share a row with gaps between them. */
function slotWidth(availableColumns: number, count: number): number {
  return Math.floor((availableColumns - GALLERY_GAP_CELLS * (count - 1)) / count)
}

/** Returns how many bytes a base64 string decodes to. */
export function decodedByteCount(base64: string): number {
  let padding = 0
  if (base64.endsWith('==')) {
    padding = 2
  } else if (base64.endsWith('=')) {
    padding = 1
  }
  return Math.floor((base64.length * 3) / 4) - padding
}

/** Parses the `"<width> <height>"` line ImageMagick prints for `-format '%w %h'`. */
export function parseSizeLine(text: string): PixelSize | undefined {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(text)
  if (match === null) {
    return undefined
  }
  return { widthPixels: Number(match[1]), heightPixels: Number(match[2]) }
}

// A PNG starts with an 8-byte signature, then the IHDR chunk: 4 bytes of
// length, the letters IHDR, then width and height as big-endian 32-bit numbers.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const IHDR_NAME_OFFSET = 12
const IHDR_NAME = [0x49, 0x48, 0x44, 0x52]
const WIDTH_OFFSET = 16
const HEIGHT_OFFSET = 20
const HEADER_BYTES = 24
// 24 bytes are 32 base64 characters.
const HEADER_BASE64_LENGTH = 32

/** Reads a big-endian 32-bit number from four bytes. */
function readUint32(bytes: readonly number[], offset: number): number {
  const BYTE_VALUES = 256
  let value = 0
  for (let index = offset; index < offset + 4; index += 1) {
    value = value * BYTE_VALUES + (bytes[index] ?? 0)
  }
  return value
}

/** Reads a PNG's size from its header, or returns undefined when the bytes are not a PNG. */
export function readPngSize(base64: string): PixelSize | undefined {
  let header: number[]
  try {
    // atob gives one character per byte.
    header = [...atob(base64.slice(0, HEADER_BASE64_LENGTH))].map(character => character.charCodeAt(0))
  } catch {
    return undefined
  }
  if (header.length < HEADER_BYTES) {
    return undefined
  }
  const hasSignature = PNG_SIGNATURE.every((byte, index) => header[index] === byte)
  const hasHeaderChunk = IHDR_NAME.every((byte, index) => header[IHDR_NAME_OFFSET + index] === byte)
  if (!hasSignature || !hasHeaderChunk) {
    return undefined
  }
  return { widthPixels: readUint32(header, WIDTH_OFFSET), heightPixels: readUint32(header, HEIGHT_OFFSET) }
}
