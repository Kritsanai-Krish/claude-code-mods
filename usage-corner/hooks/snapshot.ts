import type { LimitReading, UsageSnapshot } from '../types'

/** What the engine reports at one moment, gathered for one snapshot. */
export type EngineReading = {
  model: string
  startedAt: number
  context: { tokens?: number; window: number; percent?: number }
  costUsd: number | undefined
  limits: LimitReading[]
  /** The effort the settings file holds for this model, if any. */
  settingsEffort: string | undefined
  /** A local estimate of the context, for when the API has not counted it yet. */
  estimatedContextTokens: number | undefined
}

/** Why a snapshot is being taken, which decides what the reading can be trusted for. */
export type RefreshCause = {
  /** A model response just came back, so the limit headers are confirmed as of now. */
  isFromResponse?: boolean
  /**
   * The effort the main loop's last request went out with, as the engine
   * reports it; `level` is absent on a model that takes no effort.
   */
  requestEffort?: { level?: string }
  /** The model that answered the main loop's last turn. */
  answeringModel?: string
}

function areSameLimits(first: readonly LimitReading[], second: readonly LimitReading[]): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

/**
 * Picks the effort to show. A request's own effort is the truth at that
 * moment; between requests the settings file is watched for a change
 * (`/effort`), and an unchanged value there never overrides what the last
 * request used (a session-only effort is not written to the file).
 */
function resolveEffort(previous: UsageSnapshot | null, reading: EngineReading, cause: RefreshCause): string | undefined {
  if (cause.requestEffort !== undefined) {
    return cause.requestEffort.level
  }
  const isSameModel = previous !== null && previous.model === reading.model
  if (!isSameModel || reading.settingsEffort !== previous.settingsEffort) {
    return reading.settingsEffort
  }
  return previous.effort
}

function resolveAnsweringModel(previous: UsageSnapshot | null, reading: EngineReading, cause: RefreshCause): string | undefined {
  if (cause.answeringModel !== undefined) {
    return cause.answeringModel
  }
  const isSameModel = previous !== null && previous.model === reading.model
  return isSameModel ? previous.answeringModel : undefined
}

function resolveLimitsReadAt(previous: UsageSnapshot | null, reading: EngineReading, cause: RefreshCause, nowMilliseconds: number): number {
  const haveLimitsChanged = previous === null || !areSameLimits(previous.limits, reading.limits)
  if (cause.isFromResponse === true || haveLimitsChanged) {
    return nowMilliseconds
  }
  return previous.limitsReadAt
}

/** Builds the snapshot the corner draws from the engine's reading and what the previous snapshot knew. */
export function buildSnapshot(
  previous: UsageSnapshot | null,
  reading: EngineReading,
  cause: RefreshCause,
  nowMilliseconds: number,
): UsageSnapshot {
  const snapshot: UsageSnapshot = {
    model: reading.model,
    startedAt: reading.startedAt,
    contextWindow: reading.context.window,
    isContextEstimated: false,
    limits: reading.limits,
    limitsReadAt: resolveLimitsReadAt(previous, reading, cause, nowMilliseconds),
  }
  if (reading.context.tokens !== undefined) {
    snapshot.contextTokens = reading.context.tokens
    snapshot.contextPercent = reading.context.percent ?? Math.round((reading.context.tokens / reading.context.window) * 100)
  } else if (reading.estimatedContextTokens !== undefined && reading.context.window > 0) {
    snapshot.contextTokens = reading.estimatedContextTokens
    snapshot.contextPercent = Math.round((reading.estimatedContextTokens / reading.context.window) * 100)
    snapshot.isContextEstimated = true
  }
  // Optional fields are left out, not set to undefined: the snapshot is stored as JSON.
  const effort = resolveEffort(previous, reading, cause)
  if (effort !== undefined) {
    snapshot.effort = effort
  }
  if (reading.settingsEffort !== undefined) {
    snapshot.settingsEffort = reading.settingsEffort
  }
  const answeringModel = resolveAnsweringModel(previous, reading, cause)
  if (answeringModel !== undefined) {
    snapshot.answeringModel = answeringModel
  }
  if (reading.costUsd !== undefined) {
    snapshot.costUsd = reading.costUsd
  }
  return snapshot
}

/** True when two snapshots hold the same figures, so storing the new one would redraw for nothing. */
export function isSameSnapshot(first: UsageSnapshot | null, second: UsageSnapshot): boolean {
  if (first === null) {
    return false
  }
  // Both are built by buildSnapshot, field by field in the same order.
  return JSON.stringify(first) === JSON.stringify(second)
}
