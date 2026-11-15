// How big a picture is drawn, in terminal cells. Pure functions, no `$`.

// A terminal cell is about twice as tall as it is wide (JetBrains Mono and
// most monospace fonts sit between 1.9 and 2.2), so one row covers the height
// of two columns.
export const CELL_HEIGHT_TO_WIDTH = 2

// Rough width of one cell in image pixels at normal scaling. Used only so a
// small icon is not blown up to fill the whole transcript.
const PIXELS_PER_COLUMN = 8

export const MAX_PREVIEW_COLUMNS = 72
export const MAX_PREVIEW_ROWS = 20
// The Image element takes 1 to 255 cells on each side.
const MAX_CELLS = 255

export type CellBox = { columns: number; rows: number }

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
export function previewColumnLimit(viewportColumns: number | undefined, indent: number): number {
  const available = (viewportColumns ?? MAX_PREVIEW_COLUMNS + indent) - indent
  return Math.max(1, Math.min(MAX_PREVIEW_COLUMNS, available))
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
export function parseSizeLine(text: string): { widthPixels: number; heightPixels: number } | undefined {
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(text)
  if (match === null) {
    return undefined
  }
  return { widthPixels: Number(match[1]), heightPixels: Number(match[2]) }
}
