/** A picture ready for the terminal: a PNG file on disk and its size in pixels. */
export type PreviewImage = {
  pngPath: string
  widthPixels: number
  heightPixels: number
}

/** The pictures attached to one submitted prompt, found again by its text. */
export type PromptPreview = {
  promptText: string
  images: PreviewImage[]
}

declare module 'claude-code' {
  interface PluginState {
    'image-preview': {
      'prompt-previews': Shaped<PromptPreview[]>
    }
  }
}
