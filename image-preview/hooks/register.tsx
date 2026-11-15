import type { EngineInterface, ImageSource, Register, RenderInput, SessionAppendInput } from 'claude-code'
import type { Picture, PreviewEntry } from '../types'
import { findPromptImages, findToolResultImages, messageKeyOf } from './blocks'
import type { FoundImage } from './blocks'
import {
  isPreviewImage, loadImageSource, openInViewer, removeOldPreviews, savePreview, toSafeFileName,
} from './convert'
import { GALLERY_GAP_CELLS, layoutGallery, previewColumnLimit } from './image-size'
import type { CellBox } from './image-size'
import { readSettings } from './options'
import type { Settings } from './options'
import { findPreview, findPromptPreviewByText, rememberPreview } from './state'

// Previews sit under the row's `⎿` gutter.
const PREVIEW_INDENT = 5
// A prompt with pictures shows a `[Image #1]` marker for each in its text.
const IMAGE_MARKER = '[Image #'

/** A Read result that holds a picture (the engine's own resized copy). */
type ReadImageOutput = { type: 'image'; file: { base64: string; type: string } }

function isReadImageOutput(output: unknown): output is ReadImageOutput {
  const candidate = output as ReadImageOutput | undefined
  return candidate?.type === 'image' && typeof candidate.file?.base64 === 'string' && typeof candidate.file.type === 'string'
}

function promptKey(messageKey: string): string {
  return `prompt:${messageKey}`
}

function toolKey(toolUseId: string): string {
  return `tool:${toolUseId}`
}

/** Runs work nobody waits for: a hook must return at once, and a failure is logged, not lost. */
function runInBackground($: EngineInterface, what: string, work: Promise<void>): void {
  work.catch((error: unknown) => {
    $.ui.log(`image-preview: could not ${what}: ${String(error)}`)
  })
}

/** Prepares every picture of one row and remembers them under the row's key. */
async function storePictures(
  $: EngineInterface,
  key: string,
  images: readonly FoundImage[],
  promptText?: string,
): Promise<void> {
  const fileName = toSafeFileName(key)
  const pictures = await Promise.all(images.map((image, index) => savePreview($, image, `${fileName}-${index}`)))
  const entry: PreviewEntry = { key, pictures }
  if (promptText !== undefined) {
    entry.promptText = promptText
  }
  await rememberPreview($, entry)
}

/** Returns the text of a row's first text block: what the transcript shows for a prompt. */
function firstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined
  }
  for (const block of content) {
    const candidate = block as { type?: unknown; text?: unknown } | null
    if (candidate?.type === 'text' && typeof candidate.text === 'string') {
      return candidate.text
    }
  }
  return undefined
}

/** A prompt was stored: keep the pictures attached to it. */
function capturePromptPictures($: EngineInterface, e: SessionAppendInput): void {
  const messageKey = messageKeyOf(e.uuid)
  const images = findPromptImages(e.message.content)
  // A subagent's rows are not drawn in this transcript.
  if (e.agentId !== undefined || messageKey === undefined || images.length === 0) {
    return
  }
  const work = storePictures($, promptKey(messageKey), images, firstText(e.message.content))
  runInBackground($, 'prepare the pictures of a prompt', work)
}

/** Tool results were stored: keep the pictures any tool returned (Read, a screenshot tool, an MCP server). */
function captureToolPictures($: EngineInterface, e: SessionAppendInput): void {
  if (e.agentId !== undefined) {
    return
  }
  for (const result of findToolResultImages(e.message.content)) {
    const work = storePictures($, toolKey(result.toolUseId), result.images)
    runInBackground($, 'prepare the pictures of a tool result', work)
  }
}

/**
 * Returns the pictures of a tool call's row. During a session they were kept
 * when the result was stored; in a resumed one only Read's stored result
 * still holds its picture, so that is prepared here.
 */
async function findToolPictures($: EngineInterface, toolUseId: string, tool: string, output: unknown): Promise<Picture[]> {
  const entry = await findPreview($, toolKey(toolUseId))
  if (entry !== undefined) {
    return entry.pictures
  }
  if (tool !== 'Read' || !isReadImageOutput(output)) {
    return []
  }
  const image: FoundImage = { mediaType: output.file.type, base64: output.file.base64 }
  return [await savePreview($, image, `${toSafeFileName(toolKey(toolUseId))}-0`)]
}

/** Returns the pictures of a prompt's row: by the row's id, or by its text while the id is a placeholder. */
async function findPromptPictures($: EngineInterface, requestId: string | undefined, text: string): Promise<Picture[]> {
  const messageKey = messageKeyOf(requestId)
  if (messageKey !== undefined) {
    const entry = await findPreview($, promptKey(messageKey))
    if (entry !== undefined) {
      return entry.pictures
    }
  }
  if (!text.includes(IMAGE_MARKER)) {
    return []
  }
  return (await findPromptPreviewByText($, text))?.pictures ?? []
}

type Row = RenderInput<'ToolUse' | 'ToolGroup' | 'UserMessage', 'terminal'>
type ReadyPicture = { source: ImageSource; pngPath: string; widthPixels: number; heightPixels: number }

/** Draws a row's pictures under it: one large, or several as rows of thumbnails; failures as a dim line each. */
async function drawPictures(
  $: EngineInterface,
  e: Row,
  pictures: readonly Picture[],
  keyPrefix: string,
  settings: Settings,
) {
  const { Box, Button, Image, Text } = $.ui.resolve(e)
  const ready: ReadyPicture[] = []
  const errors: string[] = []
  for (const picture of pictures) {
    if (isPreviewImage(picture)) {
      ready.push({ ...picture, source: await loadImageSource($, picture) })
    } else {
      errors.push(picture.error)
    }
  }
  const availableColumns = previewColumnLimit(e.viewport?.columns, PREVIEW_INDENT, Number.MAX_SAFE_INTEGER)
  const boxRows = layoutGallery(ready, availableColumns, settings.limits)

  const drawOne = (picture: ReadyPicture, box: CellBox, index: number) => {
    const size = `${picture.widthPixels}×${picture.heightPixels}`
    return (
      <Box flexDirection="column">
        <Image key={`${keyPrefix}-${index}`} source={picture.source} columns={box.columns} rows={box.rows} alt={`[image ${size}]`} />
        {settings.areCaptionsShown && (
          <Button
            key={`open-${keyPrefix}-${index}`}
            plain
            onPress={() => runInBackground($, 'open the picture', openInViewer($, picture.pngPath))}
          >
            <Text dimColor>{`${size} · open`}</Text>
          </Button>
        )}
      </Box>
    )
  }

  let pictureIndex = 0
  const galleryRows = boxRows.map(boxes => (
    <Box flexDirection="row" gap={GALLERY_GAP_CELLS}>
      {boxes.map(box => {
        const index = pictureIndex
        pictureIndex += 1
        const picture = ready[index]
        return picture === undefined ? null : drawOne(picture, box, index)
      })}
    </Box>
  ))
  return (
    <Box flexDirection="column" paddingLeft={PREVIEW_INDENT}>
      {galleryRows}
      {errors.map(error => <Text dimColor>{`[image preview: ${error}]`}</Text>)}
    </Box>
  )
}

/**
 * Shows pictures in the transcript: the ones attached to a prompt under the
 * prompt, and the ones a tool returned (Read, screenshots, MCP tools) under
 * the tool's row. Terminal only: other surfaces draw pictures themselves.
 */
export const register: Register = (on, options) => {
  const settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    runInBackground($, 'clean the preview cache', removeOldPreviews($, await $.clock.now()))
    return next(e)
  })

  // Every row a conversation keeps passes here once. The pictures are copied
  // out as the row goes by; the row itself is passed on untouched.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    capturePromptPictures($, e)
    return next(e)
  })
  // A prompt sent while Claude is working is folded into the running turn.
  on('session.append', { door: 'delivery' }, async ($, e, next) => {
    capturePromptPictures($, e)
    return next(e)
  })
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    captureToolPictures($, e)
    return next(e)
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    // Only the terminal has an Image element.
    if (e.surface !== 'terminal') {
      return row
    }
    const pictures = await findPromptPictures($, e.requestId, e.props.text)
    if (pictures.length === 0) {
      return row
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        {await drawPictures($, e, pictures, 'prompt', settings)}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') {
      return row
    }
    const pictures = await findToolPictures($, e.props.tool_use_id, e.props.tool, e.props.output)
    if (pictures.length === 0) {
      return row
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        {await drawPictures($, e, pictures, 'tool', settings)}
      </Box>
    )
  })

  // Several calls in a row fold into one line ("Read 2 files"); the calls then
  // draw no rows of their own, so the group shows their pictures.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isExpanded) {
      return row
    }
    const pictures: Picture[] = []
    for (const call of e.props.calls) {
      if (call.tool_use_id !== undefined) {
        pictures.push(...(await findToolPictures($, call.tool_use_id, call.tool, call.output)))
      }
    }
    if (pictures.length === 0) {
      return row
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        {await drawPictures($, e, pictures, 'group', settings)}
      </Box>
    )
  })
}
