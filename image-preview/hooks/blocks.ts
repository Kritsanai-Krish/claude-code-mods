// Finds the pictures in a conversation row. The rows are the engine's
// (`session.append`), their `content` spelled as the Messages API spells it;
// everything is checked before use because a tool result can hold anything.

/** One picture taken out of a row: its bytes as base64 and what format they are. */
export type FoundImage = { mediaType: string; base64: string }

/** The pictures one tool call returned. */
export type ToolResultImages = { toolUseId: string; images: FoundImage[] }

// The raster formats ImageMagick is asked to decode. SVG and the like are left
// out on purpose: their decoders run far more code on bytes a tool handed over.
const PREVIEWABLE_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

/** Reads one content block as a picture, or undefined when it is not a base64 image of a known format. */
function toFoundImage(block: unknown): FoundImage | undefined {
  if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) {
    return undefined
  }
  const { type, media_type: mediaType, data } = block.source
  if (type !== 'base64' || typeof mediaType !== 'string' || typeof data !== 'string' || data === '') {
    return undefined
  }
  if (!PREVIEWABLE_MEDIA_TYPES.includes(mediaType)) {
    return undefined
  }
  return { mediaType, base64: data }
}

function findImages(content: unknown): FoundImage[] {
  if (!Array.isArray(content)) {
    return []
  }
  const images: FoundImage[] = []
  for (const block of content) {
    const image = toFoundImage(block)
    if (image !== undefined) {
      images.push(image)
    }
  }
  return images
}

/** Returns the pictures attached to a prompt row, in the order they were attached. */
export function findPromptImages(content: unknown): FoundImage[] {
  return findImages(content)
}

/** Returns the pictures inside a row of tool results, grouped by the call each result answers. */
export function findToolResultImages(content: unknown): ToolResultImages[] {
  if (!Array.isArray(content)) {
    return []
  }
  const results: ToolResultImages[] = []
  for (const block of content) {
    if (!isRecord(block) || block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
      continue
    }
    const images = findImages(block.content)
    if (images.length > 0) {
      results.push({ toolUseId: block.tool_use_id, images })
    }
  }
  return results
}

// A stored message's id and the id of the transcript row that draws it agree
// on everything but the last group: `f94e7fd5-072b-46af-a4a1-…`.
const UUID_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4})-[0-9a-f]{12}$/i

/** Returns the part of a message id that its transcript row shares, or undefined for an id of another form. */
export function messageKeyOf(id: string | undefined): string | undefined {
  if (id === undefined) {
    return undefined
  }
  return UUID_PATTERN.exec(id)?.[1]
}
