// Turns any picture Claude Code holds (PNG, JPEG, GIF, WebP) into a PNG file
// the terminal can draw. The kitty graphics protocol Ghostty speaks takes PNG
// or raw pixels only, so everything else goes through ImageMagick.
import type { EngineInterface } from 'claude-code'
import type { PreviewImage } from '../types'
import { parseSizeLine } from './image-size'

const CACHE_FOLDER = '.cache/claude-image-preview'
// The engine already shrinks images for the model; this only bounds the odd
// huge attachment so the terminal never decodes something enormous.
const MAX_EDGE_PIXELS = 1600
const CONVERT_TIMEOUT_MS = 20_000
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAGICK = 'magick'

let cacheFolderPromise: Promise<string> | undefined

async function createCacheFolder($: EngineInterface): Promise<string> {
  const { stdout } = await $.process.run(['printenv', 'HOME'])
  const home = stdout.trim()
  if (!home.startsWith('/')) {
    throw new Error(`image-preview: HOME is not an absolute path: "${home}"`)
  }
  const folder = `${home}/${CACHE_FOLDER}`
  const made = await $.process.run(['mkdir', '-p', '-m', '700', folder])
  if (made.exitCode !== 0) {
    throw new Error(`image-preview: cannot create ${folder}: ${made.stderr.trim()}`)
  }
  return folder
}

/** Returns the folder converted previews live in, creating it once. */
export function getCacheFolder($: EngineInterface): Promise<string> {
  cacheFolderPromise ??= createCacheFolder($)
  return cacheFolderPromise
}

/** Keeps only file-name-safe characters, so an id can name a cache file. */
export function toSafeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

/**
 * Writes a base64 picture to the cache as PNG and returns it, or the reason it
 * could not (most often: ImageMagick is not installed).
 */
export async function convertToPng(
  $: EngineInterface,
  mediaType: string,
  base64: string,
  name: string,
): Promise<PreviewImage | { error: string }> {
  const folder = await getCacheFolder($)
  const dataUriPath = `${folder}/${name}.b64`
  const pngPath = `${folder}/${name}.png`

  // $.fs.write takes text only, so the bytes travel as a data URI that
  // ImageMagick's `inline:` reader decodes from the file.
  await $.fs.write(dataUriPath, `data:${mediaType};base64,${base64}`)
  try {
    const result = await $.process.run(
      [
        MAGICK, `inline:${dataUriPath}`,
        '-delete', '1--1', // first frame only (animated GIF / WebP)
        '-auto-orient',
        '-resize', `${MAX_EDGE_PIXELS}x${MAX_EDGE_PIXELS}>`,
        '-format', '%w %h',
        '-write', `PNG:${pngPath}`,
        'info:',
      ],
      { timeoutMs: CONVERT_TIMEOUT_MS },
    )
    if (result.exitCode !== 0) {
      return { error: `ImageMagick failed (${result.exitCode}): ${result.stderr.trim().split('\n')[0]}` }
    }
    const size = parseSizeLine(result.stdout)
    if (size === undefined) {
      return { error: `unexpected ImageMagick output: "${result.stdout.trim()}"` }
    }
    return { pngPath, ...size }
  } catch (error) {
    // run() rejects only when the command cannot start: no ImageMagick.
    return { error: `cannot run ${MAGICK} (install ImageMagick): ${String(error)}` }
  } finally {
    await $.process.run(['rm', '-f', dataUriPath]).catch(() => undefined)
  }
}

/** Deletes previews older than a week, so the cache does not grow forever. */
export async function removeOldPreviews($: EngineInterface, nowMs: number): Promise<void> {
  const folder = await getCacheFolder($)
  const entries = await $.fs.list(folder)
  const stale = entries
    .filter(entry => entry.kind === 'file' && nowMs - entry.mtimeMs > CACHE_MAX_AGE_MS)
    .map(entry => `${folder}/${entry.name}`)
  if (stale.length === 0) {
    return
  }
  await $.process.run(['rm', '-f', '--', ...stale])
}
