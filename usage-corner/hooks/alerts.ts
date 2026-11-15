import { isSameResetMoment } from './reset-time'

/** The limit percentages that raise a warning, lowest first. */
export const LIMIT_ALERT_THRESHOLDS: readonly number[] = [80, 95]
/** The context-fill percentages that raise a warning, lowest first. */
export const CONTEXT_ALERT_THRESHOLDS: readonly number[] = [80, 90]
// Below this the context warning re-arms: a /compact or /clear brought it down.
const CONTEXT_REARM_PERCENT = 60

/** One limit window to watch. */
export type WatchedWindow = {
  kind: string
  title: string
  percentUsed: number
  resetsAtMilliseconds?: number
  /** How the warning words the reset: `in 1h20m`, `Nov 17, 10pm`, or '' when unknown. */
  resetText: string
  hasReset: boolean
}

/** What was last seen of one window: which period it was in and the threshold already warned at. */
export type WindowMemory = { resetsAtMilliseconds?: number; resetText: string; warnedAt: number; seenAt: number }

/** Per window kind, kept across sessions so a new session does not repeat a warning. */
export type AlertMemory = Record<string, WindowMemory>

const MEMORY_LIFETIME_MILLISECONDS = 8 * 24 * 60 * 60 * 1000

/**
 * Returns the highest threshold `percentUsed` has reached that is above the
 * one already warned at, or undefined when there is nothing new to say.
 */
export function newThresholdReached(
  thresholds: readonly number[],
  percentUsed: number,
  alreadyWarnedAt: number,
): number | undefined {
  let reached: number | undefined
  for (const threshold of thresholds) {
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

/** True when the window is still in the period the memory describes. */
function isSamePeriod(remembered: WindowMemory, window: WatchedWindow): boolean {
  if (remembered.resetsAtMilliseconds !== undefined && window.resetsAtMilliseconds !== undefined) {
    return isSameResetMoment(remembered.resetsAtMilliseconds, window.resetsAtMilliseconds)
  }
  return remembered.resetText === window.resetText
}

function isExpired(remembered: WindowMemory, nowMilliseconds: number): boolean {
  const lastRelevantAt = remembered.resetsAtMilliseconds ?? remembered.seenAt
  return nowMilliseconds - lastRelevantAt > MEMORY_LIFETIME_MILLISECONDS
}

/**
 * Decides what to say about the limit windows: a warning when one first
 * reaches 80% and again at 95%, once each per reset period, and a note when a
 * window that had been warned about resets. A window missing from `windows`
 * keeps its memory (the headers are empty until the first reply), and memory
 * of a period long over is dropped.
 */
export function decideAlerts(
  previous: AlertMemory,
  windows: readonly WatchedWindow[],
  nowMilliseconds: number,
): { messages: string[]; memory: AlertMemory } {
  const messages: string[] = []
  const memory: AlertMemory = {}
  for (const [kind, remembered] of Object.entries(previous)) {
    if (!isExpired(remembered, nowMilliseconds)) {
      memory[kind] = remembered
    }
  }
  for (const window of windows) {
    const remembered = previous[window.kind]
    const isContinuing = remembered !== undefined && !window.hasReset && isSamePeriod(remembered, window)
    if (remembered !== undefined && !isContinuing && remembered.warnedAt > 0) {
      messages.push(`✓ ${window.title} has reset`)
    }
    if (window.hasReset) {
      delete memory[window.kind]
      continue
    }
    const alreadyWarnedAt = isContinuing ? remembered.warnedAt : 0
    const reached = newThresholdReached(LIMIT_ALERT_THRESHOLDS, window.percentUsed, alreadyWarnedAt)
    if (reached !== undefined) {
      messages.push(formatAlert(window))
    }
    const entry: WindowMemory = { resetText: window.resetText, warnedAt: reached ?? alreadyWarnedAt, seenAt: nowMilliseconds }
    if (window.resetsAtMilliseconds !== undefined) {
      entry.resetsAtMilliseconds = window.resetsAtMilliseconds
    }
    memory[window.kind] = entry
  }
  return { messages, memory }
}

/** Reads the stored memory, treating anything malformed as empty. */
export function toAlertMemory(stored: unknown): AlertMemory {
  if (typeof stored !== 'object' || stored === null) {
    return {}
  }
  const memory: AlertMemory = {}
  for (const [kind, value] of Object.entries(stored)) {
    const candidate = value as Partial<WindowMemory> | null
    if (typeof candidate?.warnedAt !== 'number' || typeof candidate.seenAt !== 'number' || typeof candidate.resetText !== 'string') {
      continue
    }
    const entry: WindowMemory = { resetText: candidate.resetText, warnedAt: candidate.warnedAt, seenAt: candidate.seenAt }
    if (typeof candidate.resetsAtMilliseconds === 'number') {
      entry.resetsAtMilliseconds = candidate.resetsAtMilliseconds
    }
    memory[kind] = entry
  }
  return memory
}

/**
 * Decides whether the context fill deserves a warning: once at 80% and once
 * at 90% on the way up. `level` is the threshold already warned at, to store
 * for next time; it returns to 0 when the context has been brought back down.
 */
export function decideContextAlert(
  previousLevel: number,
  contextPercent: number | undefined,
): { level: number; message: string | undefined } {
  if (contextPercent === undefined || contextPercent < CONTEXT_REARM_PERCENT) {
    return { level: 0, message: undefined }
  }
  const reached = newThresholdReached(CONTEXT_ALERT_THRESHOLDS, contextPercent, previousLevel)
  if (reached === undefined) {
    return { level: previousLevel, message: undefined }
  }
  const message = `⚠ Context ${Math.round(contextPercent)}% full · /compact to shrink it, /clear to start fresh`
  return { level: reached, message }
}
