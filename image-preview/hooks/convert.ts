// Turns a picture Claude Code holds (PNG, JPEG, GIF, WebP as base64) into a
// PNG file the terminal can draw. The kitty graphics protocol takes PNG or raw
// pixels only: a PNG is written out as it is, anything else goes through
// ImageMagick.
import type { EngineInterface, ImageSource } from 'claude-code'
import type { Picture, PreviewImage } from '../types'
import type { FoundImage } from './blocks'
import { decodedByteCount, parseSizeLine, readPngSize } from './image-size'

const CACHE_FOLDER_NAME = 'claude-image-preview'
// The engine already shrinks images for the model; this only bounds the odd
// huge picture so the terminal never decodes something enormous.
const MAX_EDGE_PIXELS = 1600
const CONVERT_TIMEOUT_MS = 20_000
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const PNG_MEDIA_TYPE = 'image/png'

// ImageMagick 7 installs `magick`; ImageMagick 6 only has `convert`.
const IMAGE_MAGICK_COMMANDS: readonly string[] = ['magick', 'convert']

// Which decoder ImageMagick is told to use for each format. Naming it keeps
// ImageMagick from guessing a decoder from bytes a tool handed over.
const DECODER_FOR_MEDIA_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

// The Image element takes base64 PNG bytes up to 2 MiB; a bigger file is named instead.
const MAX_INLINE_PNG_BYTES = 2 * 1024 * 1024
// How many pictures' bytes are kept in memory for redraws (scrolling, resizing).
const MAX_CACHED_SOURCES = 24
// How many finished conversions are remembered by name.
const MAX_REMEMBERED_SAVES = 200

let cacheFolderPromise: Promise<string> | undefined
// Module variables below are caches only: a reload empties them and the files
// on disk fill them again.
// PNG bytes by file path, newest last.
const inlineSources = new Map<string, string>()
// Conversions by file name, so a picture asked for twice is prepared once.
const savesByName = new Map<string, Promise<Picture>>()
// The ImageMagick command that started last time; null once none could be started.
let workingImageMagick: string | null | undefined

async function createCacheFolder($: EngineInterface): Promise<string> {
  const cacheHome = await $.env.get('XDG_CACHE_HOME')
  const home = await $.env.get('HOME')
  const isAbsolute = (path: string | undefined): path is string => path !== undefined && path.startsWith('/')
  let baseFolder: string
  if (isAbsolute(cacheHome)) {
    baseFolder = cacheHome
  } else if (isAbsolute(home)) {
    baseFolder = `${home}/.cache`
  } else {
    throw new Error(`image-preview: HOME is not an absolute path: "${home}"`)
  }
  const folder = `${baseFolder}/${CACHE_FOLDER_NAME}`
  // Private to the user: the previews are copies of what was shown to Claude.
  const made = await $.process.run(['mkdir', '-p', '-m', '700', folder])
  if (made.exitCode !== 0) {
    throw new Error(`image-preview: cannot create ${folder}: ${made.stderr.trim()}`)
  }
  return folder
}

/** Returns the folder converted previews live in, creating it once. */
export function getCacheFolder($: EngineInterface): Promise<string> {
  if (cacheFolderPromise === undefined) {
    cacheFolderPromise = createCacheFolder($)
    // A failure is not remembered: the next picture tries again.
    cacheFolderPromise.catch(() => {
      cacheFolderPromise = undefined
    })
  }
  return cacheFolderPromise
}

/** Keeps only file-name-safe characters, so an id can name a cache file. */
export function toSafeFileName(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** Decodes base64 into a file. `$.fs.write` takes text only, so `base64 -d` writes the bytes. */
async function writeBytes($: EngineInterface, path: string, base64: string): Promise<void> {
  // The path travels as an argument, never inside the script text.
  const result = await $.process.run(['sh', '-c', 'base64 -d > "$1"', 'sh', path], {
    stdin: base64,
    timeoutMs: CONVERT_TIMEOUT_MS,
  })
  if (result.exitCode !== 0) {
    throw new Error(`cannot write ${path}: ${result.stderr.trim().split('\n')[0]}`)
  }
}

type MagickOutcome = { stdout: string; exitCode: number; stderr: string } | { isMissing: true }

/** Runs ImageMagick with whichever of its commands is installed, remembering which one started. */
async function runImageMagick($: EngineInterface, magickArguments: readonly string[]): Promise<MagickOutcome> {
  const candidates = workingImageMagick === undefined ? IMAGE_MAGICK_COMMANDS : [workingImageMagick]
  for (const command of candidates) {
    if (command === null) {
      break
    }
    try {
      const result = await $.process.run([command, ...magickArguments], { timeoutMs: CONVERT_TIMEOUT_MS })
      workingImageMagick = command
      return result
    } catch {
      // run() rejects only when the command cannot start: try the next name.
    }
  }
  workingImageMagick = null
  return { isMissing: true }
}

/** Converts the bytes in `sourcePath` to a PNG no larger than MAX_EDGE_PIXELS on a side. */
async function convertWithImageMagick(
  $: EngineInterface,
  sourcePath: string,
  decoder: string,
  pngPath: string,
): Promise<Picture> {
  const outcome = await runImageMagick($, [
    // `[0]`: the first frame only, of an animated GIF or WebP.
    `${decoder}:${sourcePath}[0]`,
    '-auto-orient',
    '-resize', `${MAX_EDGE_PIXELS}x${MAX_EDGE_PIXELS}>`,
    '-format', '%w %h',
    '-write', `PNG:${pngPath}`,
    'info:',
  ])
  if ('isMissing' in outcome) {
    return { error: 'install ImageMagick to preview JPEG, GIF and WebP pictures' }
  }
  if (outcome.exitCode !== 0) {
    return { error: `ImageMagick failed (${outcome.exitCode}): ${outcome.stderr.trim().split('\n')[0]}` }
  }
  const size = parseSizeLine(outcome.stdout)
  if (size === undefined) {
    return { error: `unexpected ImageMagick output: "${outcome.stdout.trim().slice(0, 80)}"` }
  }
  return { pngPath, ...size }
}

/** Keeps a PNG's bytes for drawing, dropping the oldest when the cache is full. */
function cacheInlineSource(pngPath: string, base64: string): void {
  if (decodedByteCount(base64) > MAX_INLINE_PNG_BYTES) {
    return
  }
  inlineSources.delete(pngPath)
  inlineSources.set(pngPath, base64)
  const oldestPath = inlineSources.keys().next().value
  if (inlineSources.size > MAX_CACHED_SOURCES && oldestPath !== undefined) {
    inlineSources.delete(oldestPath)
  }
}

async function preparePicture($: EngineInterface, image: FoundImage, name: string): Promise<Picture> {
  try {
    const folder = await getCacheFolder($)
    const pngPath = `${folder}/${name}.png`
    const pngSize = image.mediaType === PNG_MEDIA_TYPE ? readPngSize(image.base64) : undefined
    const isSmallEnough = pngSize !== undefined && pngSize.widthPixels <= MAX_EDGE_PIXELS && pngSize.heightPixels <= MAX_EDGE_PIXELS
    if (isSmallEnough) {
      await writeBytes($, pngPath, image.base64)
      cacheInlineSource(pngPath, image.base64)
      return { pngPath, ...pngSize }
    }
    const decoder = DECODER_FOR_MEDIA_TYPE[image.mediaType]
    if (decoder === undefined) {
      return { error: `cannot preview ${image.mediaType}` }
    }
    const sourcePath = `${folder}/${name}.source`
    try {
      await writeBytes($, sourcePath, image.base64)
      return await convertWithImageMagick($, sourcePath, decoder, pngPath)
    } finally {
      await $.process.run(['rm', '-f', '--', sourcePath]).catch(() => undefined)
    }
  } catch (error) {
    return { error: String(error) }
  }
}

/**
 * Writes a picture to the cache as a PNG named `name` and returns it, or the
 * reason it could not be prepared. Never rejects. Asking again under the same
 * name returns the first answer, so a row drawn many times converts once.
 */
export function savePreview($: EngineInterface, image: FoundImage, name: string): Promise<Picture> {
  const remembered = savesByName.get(name)
  if (remembered !== undefined) {
    return remembered
  }
  const save = preparePicture($, image, name)
  savesByName.set(name, save)
  const oldestName = savesByName.keys().next().value
  if (savesByName.size > MAX_REMEMBERED_SAVES && oldestName !== undefined) {
    savesByName.delete(oldestName)
  }
  // A failure (ImageMagick missing, a full disk) may be fixed later: let the next ask try again.
  void save.then(picture => {
    if (!isPreviewImage(picture)) {
      savesByName.delete(name)
    }
  })
  return save
}

/**
 * Returns what the Image element should draw for a prepared picture: its
 * bytes when they are small enough to send (this also works over ssh, where
 * the terminal cannot read this machine's files), else the file's path.
 */
export async function loadImageSource($: EngineInterface, image: PreviewImage): Promise<ImageSource> {
  const cached = inlineSources.get(image.pngPath)
  if (cached !== undefined) {
    return { png: cached }
  }
  try {
    const { base64 } = await $.fs.read(image.pngPath, { as: 'bytes' })
    if (decodedByteCount(base64) <= MAX_INLINE_PNG_BYTES) {
      cacheInlineSource(image.pngPath, base64)
      return { png: base64 }
    }
  } catch {
    // Too large to read into the mod, or unreadable: the terminal reads the file itself.
  }
  return { file: image.pngPath, format: 'png' }
}

/** True for a picture that is ready to draw. */
export function isPreviewImage(picture: Picture): picture is PreviewImage {
  return 'pngPath' in picture
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

/** Opens a file in the desktop's default viewer: `xdg-open` on Linux, `open` on macOS. */
export async function openInViewer($: EngineInterface, path: string): Promise<void> {
  const OPENERS: readonly string[] = ['xdg-open', 'open']
  for (const opener of OPENERS) {
    try {
      const result = await $.process.run([opener, path], { timeoutMs: CONVERT_TIMEOUT_MS })
      if (result.exitCode === 0) {
        return
      }
    } catch {
      // This opener is not installed: try the next.
    }
  }
  throw new Error(`no viewer could open ${path}`)
}
