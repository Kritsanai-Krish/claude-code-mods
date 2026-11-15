import type {
  EngineInterface, ImageSource, PromptSubmitAttachment, Register, RenderInput,
} from 'claude-code'
import type { PreviewImage } from '../types'
import { convertToPng, removeOldPreviews, toSafeFileName } from './convert'
import {
  MAX_PREVIEW_ROWS, decodedByteCount, fitImageToCells, previewColumnLimit,
} from './image-size'
import { findPromptPreview, rememberPromptPreview } from './state'

// Previews sit under the row's `⎿` gutter.
const PREVIEW_INDENT = 5
// The Image element takes base64 PNG bytes up to 2 MiB; bigger goes via a file.
const MAX_INLINE_PNG_BYTES = 2 * 1024 * 1024
const PNG_MEDIA_TYPE = 'image/png'

/** A Read result that holds a picture (the engine's own resized copy). */
type ReadImageOutput = {
  type: 'image'
  file: {
    base64: string
    type: string
    dimensions?: { displayWidth?: number; displayHeight?: number }
  }
}

type AttachedImage = { mediaType: string; base64: string }
type Preview = { source: ImageSource; widthPixels: number; heightPixels: number }
type PreviewOutcome = Preview | { error: string }

// Converted Read images by tool_use_id. A module variable is enough: a reload
// clears it and the next draw converts again from the stored result.
const readPreviews = new Map<string, Promise<PreviewOutcome>>()

function isReadImageOutput(output: unknown): output is ReadImageOutput {
  const candidate = output as ReadImageOutput | undefined
  return candidate?.type === 'image' && typeof candidate.file?.base64 === 'string'
}

function previewFromFile(image: PreviewImage): Preview {
  return {
    source: { file: image.pngPath, format: 'png' },
    widthPixels: image.widthPixels,
    heightPixels: image.heightPixels,
  }
}

/** Builds what the terminal draws for a Read image, converting it when it is not a small PNG. */
async function buildReadPreview(
  $: EngineInterface,
  toolUseId: string,
  output: ReadImageOutput,
): Promise<PreviewOutcome> {
  const { base64, type, dimensions } = output.file
  const width = dimensions?.displayWidth
  const height = dimensions?.displayHeight
  const isSmallPng = type === PNG_MEDIA_TYPE && decodedByteCount(base64) <= MAX_INLINE_PNG_BYTES
  if (isSmallPng && width !== undefined && height !== undefined) {
    return { source: { png: base64 }, widthPixels: width, heightPixels: height }
  }
  const converted = await convertToPng($, type, base64, `read-${toSafeFileName(toolUseId)}`)
  if ('error' in converted) {
    return converted
  }
  return previewFromFile(converted)
}

function getReadPreview($: EngineInterface, toolUseId: string, output: ReadImageOutput): Promise<PreviewOutcome> {
  let preview = readPreviews.get(toolUseId)
  if (preview === undefined) {
    preview = buildReadPreview($, toolUseId, output).catch(error => ({ error: String(error) }))
    readPreviews.set(toolUseId, preview)
  }
  return preview
}

/** Draws one picture (or why it cannot be shown) sized to the transcript. */
function drawPreview(
  e: RenderInput<'ToolUse' | 'ToolGroup' | 'UserMessage', 'terminal'>,
  $: EngineInterface,
  outcome: PreviewOutcome,
  key: string,
) {
  const { Box, Image, Text } = $.ui.resolve(e)
  if ('error' in outcome) {
    return (
      <Box paddingLeft={PREVIEW_INDENT}>
        <Text dimColor>[image preview: {outcome.error}]</Text>
      </Box>
    )
  }
  const maxColumns = previewColumnLimit(e.viewport?.columns, PREVIEW_INDENT)
  const box = fitImageToCells(outcome.widthPixels, outcome.heightPixels, maxColumns, MAX_PREVIEW_ROWS)
  return (
    <Box paddingLeft={PREVIEW_INDENT}>
      <Image
        key={key}
        source={outcome.source}
        columns={box.columns}
        rows={box.rows}
        alt={`[image ${outcome.widthPixels}x${outcome.heightPixels}]`}
      />
    </Box>
  )
}

/** Reads every slice of one attached item, joining the base64 pieces. */
async function readAttachment($: EngineInterface, id: string): Promise<AttachedImage | undefined> {
  let media = await $.prompt.media({ id })
  if ('unreadable' in media && media.unreadable !== undefined) {
    return undefined
  }
  if ('deny' in media && media.deny !== undefined) {
    return undefined
  }
  const pieces = [media.base64]
  while (media.next !== undefined) {
    media = await $.prompt.media({ id, offset: media.next })
    if (media.base64 === undefined) {
      return undefined
    }
    pieces.push(media.base64)
  }
  return { mediaType: media.mediaType, base64: pieces.join('') }
}

/** Copies the bytes of every image attached to the prompt being submitted. */
async function copyAttachedImages(
  $: EngineInterface,
  items: readonly PromptSubmitAttachment[],
): Promise<AttachedImage[]> {
  const copies: AttachedImage[] = []
  for (const item of items) {
    if (item.type !== 'image' || item.id === undefined) {
      continue
    }
    const copy = await readAttachment($, item.id)
    if (copy !== undefined) {
      copies.push(copy)
    }
  }
  return copies
}

/** Converts a prompt's images to PNG files and remembers them under its text. */
async function storePromptPreviews(
  $: EngineInterface,
  promptText: string,
  attachments: AttachedImage[],
): Promise<void> {
  const batchName = `prompt-${Date.now()}`
  const images: PreviewImage[] = []
  for (const [index, attachment] of attachments.entries()) {
    const converted = await convertToPng($, attachment.mediaType, attachment.base64, `${batchName}-${index}`)
    if ('error' in converted) {
      $.ui.toast(`image-preview: ${converted.error}`)
      continue
    }
    images.push(converted)
  }
  if (images.length > 0) {
    await rememberPromptPreview($, { promptText, images })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    void removeOldPreviews($, Date.now()).catch(() => undefined)
    return next(e)
  })

  // Attached pictures are readable only while their prompt is being
  // submitted, so copy them now and convert after the prompt has gone on.
  on('prompt.submit', async ($, e, next) => {
    const attachments = await copyAttachedImages($, e.attachments ?? []).catch(() => [])
    const result = await next(e)
    if (attachments.length > 0) {
      void storePromptPreviews($, e.text, attachments).catch(error =>
        $.ui.toast(`image-preview: ${String(error)}`),
      )
    }
    return result
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const row = await next(e)
    // Only the terminal has an Image element.
    if (e.surface !== 'terminal') {
      return row
    }
    const preview = await findPromptPreview($, e.props.text)
    if (preview === undefined) {
      return row
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        {preview.images.map((image, index) =>
          drawPreview(e, $, previewFromFile(image), `prompt-${index}`),
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal') {
      return row
    }
    if (e.props.tool !== 'Read' || !isReadImageOutput(e.props.output)) {
      return row
    }
    const outcome = await getReadPreview($, e.props.tool_use_id, e.props.output)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        {drawPreview(e, $, outcome, 'read')}
      </Box>
    )
  })

  // Several reads in a row fold into one "Read 2 files" line; the calls then
  // draw no ToolUse rows of their own, so the group shows their pictures.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'terminal' || e.props.isExpanded) {
      return row
    }
    const pictures = []
    for (const call of e.props.calls) {
      if (call.tool !== 'Read' || call.tool_use_id === undefined || !isReadImageOutput(call.output)) {
        continue
      }
      const outcome = await getReadPreview($, call.tool_use_id, call.output)
      pictures.push(drawPreview(e, $, outcome, `read-${call.tool_use_id}`))
    }
    if (pictures.length === 0) {
      return row
    }
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        {pictures}
      </Box>
    )
  })
}
