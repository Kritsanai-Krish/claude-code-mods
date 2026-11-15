/** A picture ready for the terminal: a PNG file on disk and its size in pixels. */
export type PreviewImage = {
  pngPath: string
  widthPixels: number
  heightPixels: number
}

/** A picture that could not be prepared, and why (most often: ImageMagick is not installed). */
export type PreviewFailure = { error: string }

/** One picture of a row: ready to draw, or the reason it is not. */
export type Picture = PreviewImage | PreviewFailure

/** The pictures of one transcript row. */
export type PreviewEntry = {
  /** `prompt:<message key>` for a prompt's row, `tool:<tool_use_id>` for a tool call's. */
  key: string
  /** A prompt's text, to find its pictures while the row is still drawn under a placeholder id. */
  promptText?: string
  pictures: Picture[]
}

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      previews: Shaped<PreviewEntry[]>
    }
  }
}
