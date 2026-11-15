import { SIZE_LIMITS } from './image-size'
import type { SizeLimits } from './image-size'

/** How the mod is set up, from its rows in `/config` (plugin.json `userConfig`). */
export type Settings = {
  limits: SizeLimits
  /** Whether each picture gets a line with its size and an "open" button. */
  areCaptionsShown: boolean
}

export const DEFAULT_SETTINGS: Settings = { limits: SIZE_LIMITS.medium, areCaptionsShown: true }

/** Turns the raw option values into settings, falling back to the default for anything missing or malformed. */
export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  const size = options.size
  const isKnownSize = size === 'small' || size === 'medium' || size === 'large'
  return {
    limits: isKnownSize ? SIZE_LIMITS[size] : DEFAULT_SETTINGS.limits,
    areCaptionsShown: typeof options.captions === 'boolean' ? options.captions : DEFAULT_SETTINGS.areCaptionsShown,
  }
}
