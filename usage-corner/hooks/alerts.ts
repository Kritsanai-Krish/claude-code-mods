import type { EngineInterface } from 'claude-code'

/** The percentages that raise a warning, lowest first. */
export const ALERT_THRESHOLDS: readonly number[] = [80, 95]

/** One limit window to watch: `windowKey` changes when the window resets, so the next period warns again. */
export type WatchedWindow = { windowKey: string; title: string; percentUsed: number; resetText: string }

/** Which threshold each window last warned at, kept across sessions so a new session does not repeat it. */
export type AlertMemory = Record<string, number>

const ALERT_STORE_KEY = 'alerts-v1'

/**
 * Returns the highest threshold `percentUsed` has reached that is above the
 * one already warned at, or undefined when there is nothing new to say.
 */
export function newThresholdReached(percentUsed: number, alreadyWarnedAt: number): number | undefined {
  let reached: number | undefined
  for (const threshold of ALERT_THRESHOLDS) {
    if (percentUsed >= threshold && threshold > alreadyWarnedAt) {
      reached = threshold
    }
  }
  return reached
}

/** The warning text, e.g. `⚠ 5-hour limit at 82% · resets in 1h20m`. */
export function formatAlert(window: WatchedWindow): string {
  const resetPart = window.resetText === '' ? '' : ` · resets ${window.resetText}`
  return `⚠ ${window.title} at ${Math.round(window.percentUsed)}%${resetPart}`
}

/** Reads the stored memory, treating anything malformed as empty. */
function toAlertMemory(stored: unknown): AlertMemory {
  if (typeof stored !== 'object' || stored === null) {
    return {}
  }
  const memory: AlertMemory = {}
  for (const [key, value] of Object.entries(stored)) {
    if (typeof value === 'number') {
      memory[key] = value
    }
  }
  return memory
}

/**
 * Decides which windows to warn about: once when a window first reaches 80%
 * and once at 95%, per reset period. The memory returned holds only the
 * windows passed in, so periods that already reset are dropped, not piled up.
 */
export function decideAlerts(previous: AlertMemory, windows: readonly WatchedWindow[]): { messages: string[]; memory: AlertMemory } {
  const messages: string[] = []
  const memory: AlertMemory = {}
  for (const window of windows) {
    const alreadyWarnedAt = previous[window.windowKey] ?? 0
    const reached = newThresholdReached(window.percentUsed, alreadyWarnedAt)
    if (reached !== undefined) {
      messages.push(formatAlert(window))
    }
    memory[window.windowKey] = reached ?? alreadyWarnedAt
  }
  return { messages, memory }
}

/** Toasts the new warnings and remembers them across sessions. */
export async function warnAboutLimits($: EngineInterface, windows: readonly WatchedWindow[]): Promise<void> {
  const previous = toAlertMemory(await $.store.get(ALERT_STORE_KEY))
  const { messages, memory } = decideAlerts(previous, windows)
  for (const message of messages) {
    $.ui.toast(message)
  }
  await $.store.set(ALERT_STORE_KEY, memory)
}
