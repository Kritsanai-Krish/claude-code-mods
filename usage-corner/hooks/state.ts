import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { PanelTab, PlanUsage, SessionActivity, UsageSnapshot } from '../types'
import { EMPTY_ACTIVITY, addTurn } from './activity'
import type { ApiUsage } from './activity'
import { decideAlerts, decideContextAlert, toAlertMemory } from './alerts'
import type { WatchedWindow } from './alerts'
import { formatSpan, mergeLimits } from './limits'
import { toContextView } from './panel-format'
import { USAGE_COMMAND_ARGUMENTS, isPlanUsage, parsePlanUsage, readResultText } from './plan-usage'
import { buildSnapshot, isSameSnapshot } from './snapshot'
import type { EngineReading, RefreshCause } from './snapshot'

// Every read and update of these stays in this file: the engine lists a mod's
// state by scanning for atoms declared in the file that uses them.
// Change a shape tag when that value's fields change: a reload then ignores
// what the older code stored instead of reading it with missing fields.
const snapshotAtom = atom({ plugin: 'usage-corner', key: 'snapshot' } as const, null, { shape: 'snapshot-3' })
const planUsageAtom = atom({ plugin: 'usage-corner', key: 'planUsage' } as const, null, { shape: 'plan-usage-2' })
const activityAtom = atom({ plugin: 'usage-corner', key: 'activity' } as const, EMPTY_ACTIVITY, { shape: 'activity-1' })
const clockMinuteAtom = atom({ plugin: 'usage-corner', key: 'clockMinute' } as const, 0)
const contextAlertLevelAtom = atom({ plugin: 'usage-corner', key: 'contextAlertLevel' } as const, 0)
const tabAtom = atom({ plugin: 'usage-corner', key: 'tab' } as const, 'usage')
const contextViewAtom = atom({ plugin: 'usage-corner', key: 'contextView' } as const, null, { shape: 'context-view-2' })
const isContextLoadingAtom = atom({ plugin: 'usage-corner', key: 'isContextLoading' } as const, false)
const isPlanUsageLoadingAtom = atom({ plugin: 'usage-corner', key: 'isPlanUsageLoading' } as const, false)

const MILLISECONDS_PER_MINUTE = 60_000
const PLAN_USAGE_TIMEOUT_MILLISECONDS = 30_000
const CONTEXT_ESTIMATE_RETRY_MILLISECONDS = MILLISECONDS_PER_MINUTE
// Kept across sessions (`$.store`): every open session shares one `/usage`
// reading instead of each running its own, and warnings are not repeated.
const PLAN_USAGE_STORE_KEY = 'plan-usage-v2'
const ALERT_STORE_KEY = 'alerts-v2'

// In-flight guards live in module variables, not in state: a reload in the
// middle of a run must not leave a "loading" flag stuck on forever.
let planUsageRun: Promise<void> | undefined
let contextCountRun: Promise<void> | undefined
// When a failed context estimate may be tried again (clock milliseconds).
let nextContextEstimateAt = 0

// ---------------------------------------------------------------------------
// The snapshot: model, effort, context, limits and cost
// ---------------------------------------------------------------------------

/** Options of a snapshot refresh beyond its cause. */
export type RefreshOptions = RefreshCause & {
  /**
   * The conversation changed size without a model response (session start,
   * /clear, a compaction), so the API has no count: estimate it locally.
   */
  shouldCountContext?: boolean
}

/** Reads the effort the settings file holds for a model (`modelSettings.<id>.effortLevel`, written by /effort). */
async function readSettingsEffort($: EngineInterface, model: string): Promise<string | undefined> {
  try {
    const modelSettings: unknown = await $.settings.read({ key: 'modelSettings' })
    if (typeof modelSettings !== 'object' || modelSettings === null) {
      return undefined
    }
    const byModel = modelSettings as Record<string, { effortLevel?: unknown } | undefined>
    const modelWithoutSuffix = model.replace(/\[.*\]$/, '')
    const effort = (byModel[model] ?? byModel[modelWithoutSuffix])?.effortLevel
    return typeof effort === 'string' ? effort : undefined
  } catch {
    // No effort is a normal state (a model without effort, an unreadable file).
    return undefined
  }
}

/**
 * Returns a local estimate of the context when the API has not counted it:
 * a fresh session, or one just cleared or compacted, until its next reply.
 * The previous estimate is reused until the conversation changes size
 * (`mustRecount`); a failed estimate is tried again only after a minute.
 */
async function estimateContextTokens(
  $: EngineInterface,
  previous: UsageSnapshot | null,
  model: string,
  mustRecount: boolean,
  nowMilliseconds: number,
): Promise<number | undefined> {
  if (!mustRecount) {
    const hasEstimate = previous !== null && previous.isContextEstimated && previous.model === model
    if (hasEstimate) {
      return previous.contextTokens
    }
    if (nowMilliseconds < nextContextEstimateAt) {
      return undefined
    }
  }
  let estimate: number | undefined
  try {
    // `summary` estimates locally: no request is sent.
    const usage = await $.session.usage({ breakdown: 'summary' })
    estimate = usage.context.breakdown?.totalTokens
  } catch {
    estimate = undefined
  }
  if (estimate === undefined) {
    nextContextEstimateAt = nowMilliseconds + CONTEXT_ESTIMATE_RETRY_MILLISECONDS
  }
  return estimate
}

/**
 * Reads the model, effort, context window, rate limits and cost, and stores
 * them for the corner and the panel when anything changed. Returns the
 * snapshot now in force.
 */
async function refreshSnapshot($: EngineInterface, options: RefreshOptions): Promise<UsageSnapshot> {
  const [usage, model, nowMilliseconds, previous] = await Promise.all([
    $.session.usage(), $.session.model(), $.clock.now(), read($, snapshotAtom),
  ])
  const hasApiCount = usage.context.tokens !== undefined
  const reading: EngineReading = {
    model,
    startedAt: usage.startedAt,
    context: usage.context,
    costUsd: usage.cost?.usd,
    limits: usage.rateLimits.map(limit => ({ kind: limit.kind, percentUsed: limit.percentUsed, resetsAt: limit.resetsAt })),
    settingsEffort: await readSettingsEffort($, model),
    estimatedContextTokens: hasApiCount
      ? undefined
      : await estimateContextTokens($, previous, model, options.shouldCountContext === true, nowMilliseconds),
  }
  const snapshot = buildSnapshot(previous, reading, options, nowMilliseconds)
  if (!isSameSnapshot(previous, snapshot)) {
    await update($, snapshotAtom, () => snapshot)
  }
  return snapshot
}

/**
 * Refreshes without ever failing the event it rides on: a missing reading
 * should leave the old figures, not break a session start or a turn.
 */
export async function refreshSnapshotSafely($: EngineInterface, options: RefreshOptions = {}): Promise<void> {
  try {
    await refreshSnapshot($, options)
  } catch (error) {
    $.ui.log(`usage-corner: could not read session usage: ${String(error)}`)
  }
}

/** The corner's latest figures, or null before the first reading. */
export async function readSnapshot($: EngineInterface): Promise<UsageSnapshot | null> {
  return read($, snapshotAtom)
}

// ---------------------------------------------------------------------------
// The clock: countdowns are drawn in minutes, so the minute is state
// ---------------------------------------------------------------------------

/** Stores the current minute when it has turned, which redraws every countdown. Returns the time read. */
export async function tickClock($: EngineInterface): Promise<number> {
  const nowMilliseconds = await $.clock.now()
  const minute = Math.floor(nowMilliseconds / MILLISECONDS_PER_MINUTE)
  if ((await read($, clockMinuteAtom)) !== minute) {
    await update($, clockMinuteAtom, () => minute)
  }
  return nowMilliseconds
}

/** Everything the corner draws from. Reading the minute subscribes the corner to it. */
export async function readCornerState($: EngineInterface) {
  return {
    snapshot: await read($, snapshotAtom),
    planUsage: await read($, planUsageAtom),
    clockMinute: await read($, clockMinuteAtom),
  }
}

// ---------------------------------------------------------------------------
// /usage: fresh limit figures for every window
// ---------------------------------------------------------------------------

/** Takes over a reading another session stored when it is newer than this one's. Returns the newest known. */
async function adoptSharedPlanUsage($: EngineInterface, own: PlanUsage | null): Promise<PlanUsage | null> {
  const shared: unknown = await $.store.get(PLAN_USAGE_STORE_KEY)
  if (!isPlanUsage(shared) || shared.fetchedAt <= (own?.fetchedAt ?? 0)) {
    return own
  }
  await update($, planUsageAtom, () => shared)
  return shared
}

async function runUsageCommand($: EngineInterface): Promise<void> {
  await update($, isPlanUsageLoadingAtom, () => true)
  try {
    // The running Claude Code's own binary, so the child matches this version.
    const executable = (await $.env.get('CLAUDE_CODE_EXECPATH')) ?? 'claude'
    const home = (await $.env.get('HOME')) ?? '/'
    const result = await $.process.run([executable, ...USAGE_COMMAND_ARGUMENTS], {
      cwd: home,
      timeoutMs: PLAN_USAGE_TIMEOUT_MILLISECONDS,
    })
    if (result.exitCode !== 0) {
      throw new Error(`exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`)
    }
    const reading = parsePlanUsage(readResultText(result.stdout), await $.clock.now())
    await update($, planUsageAtom, () => reading)
    await $.store.set(PLAN_USAGE_STORE_KEY, reading)
  } catch (error) {
    // The old reading stays; the corner still has the headers' figures.
    $.ui.log(`usage-corner: could not read /usage: ${String(error)}`)
  } finally {
    await update($, isPlanUsageLoadingAtom, () => false)
  }
}

/**
 * Makes sure the `/usage` reading is at most `maxAgeMilliseconds` old: takes
 * a newer one another session stored, else runs `claude -p /usage`. Pass 0 to
 * force a run. Calls made while one is running wait for it instead of
 * starting another.
 */
export async function refreshPlanUsage($: EngineInterface, maxAgeMilliseconds: number): Promise<void> {
  if (planUsageRun !== undefined) {
    return planUsageRun
  }
  const nowMilliseconds = await $.clock.now()
  const newest = await adoptSharedPlanUsage($, await read($, planUsageAtom))
  const isFreshEnough = newest !== null && nowMilliseconds - newest.fetchedAt < maxAgeMilliseconds
  if (isFreshEnough) {
    return
  }
  planUsageRun = runUsageCommand($).finally(() => {
    planUsageRun = undefined
  })
  return planUsageRun
}

/** The latest `/usage` reading, or null before one. */
export async function readPlanUsage($: EngineInterface): Promise<PlanUsage | null> {
  return read($, planUsageAtom)
}

/** Clears flags a reload could have left behind mid-run. */
export async function clearLoadingFlags($: EngineInterface): Promise<void> {
  await update($, isPlanUsageLoadingAtom, () => false)
  await update($, isContextLoadingAtom, () => false)
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/** Lists every limit window as the warnings should word it. */
function toWatchedWindows(snapshot: UsageSnapshot, planUsage: PlanUsage | null, nowMilliseconds: number): WatchedWindow[] {
  return mergeLimits(snapshot, planUsage, nowMilliseconds).map(limit => {
    const window: WatchedWindow = {
      kind: limit.kind,
      title: limit.title,
      percentUsed: limit.percentUsed,
      resetText: limit.resetText,
      hasReset: limit.hasReset,
    }
    if (limit.resetsAtMilliseconds !== undefined) {
      window.resetsAtMilliseconds = limit.resetsAtMilliseconds
      window.resetText = `in ${formatSpan(limit.resetsAtMilliseconds - nowMilliseconds)}`
    }
    return window
  })
}

/**
 * Toasts what is new: a limit window reaching 80% or 95% (once each per
 * reset period, remembered across sessions), a warned-about window resetting,
 * and the context reaching 80% or 90% full.
 */
export async function raiseAlerts($: EngineInterface): Promise<void> {
  const snapshot = await read($, snapshotAtom)
  if (snapshot === null) {
    return
  }
  const nowMilliseconds = await $.clock.now()
  const windows = toWatchedWindows(snapshot, await read($, planUsageAtom), nowMilliseconds)
  const previousMemory = toAlertMemory(await $.store.get(ALERT_STORE_KEY))
  const { messages, memory } = decideAlerts(previousMemory, windows, nowMilliseconds)
  if (JSON.stringify(memory) !== JSON.stringify(previousMemory)) {
    await $.store.set(ALERT_STORE_KEY, memory)
  }

  // An estimate is not worth a warning; wait for the API's own count.
  const countedPercent = snapshot.isContextEstimated ? undefined : snapshot.contextPercent
  const previousLevel = await read($, contextAlertLevelAtom)
  const contextAlert = decideContextAlert(previousLevel, countedPercent)
  if (contextAlert.level !== previousLevel) {
    await update($, contextAlertLevelAtom, () => contextAlert.level)
  }
  if (contextAlert.message !== undefined) {
    messages.push(contextAlert.message)
  }
  for (const message of messages) {
    $.ui.toast(message)
  }
}

// ---------------------------------------------------------------------------
// Session activity: tokens and turns
// ---------------------------------------------------------------------------

/** Counts a finished turn: the main loop's (`isMainLoop`) or a subagent's run. */
export async function recordTurn(
  $: EngineInterface,
  turn: { durationMs: number; reason: string; usage?: ApiUsage },
  isMainLoop: boolean,
): Promise<void> {
  await update($, activityAtom, activity => addTurn(activity, turn, isMainLoop))
}

/** Starts the per-conversation counters over, as /clear starts the conversation over. */
export async function resetSessionCounters($: EngineInterface): Promise<void> {
  const fresh: SessionActivity = EMPTY_ACTIVITY
  await update($, activityAtom, () => fresh)
  await update($, contextAlertLevelAtom, () => 0)
  await update($, contextViewAtom, () => null)
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * Counts the context window by category for the Context tab. `full` is the
 * exact count /context makes (one token-count request per tool and memory
 * file); `summary` estimates locally and is free. If the exact count fails,
 * the estimate is shown instead so the tab is never empty.
 */
export async function refreshContextView($: EngineInterface, detail: 'full' | 'summary'): Promise<void> {
  if (contextCountRun !== undefined) {
    return contextCountRun
  }
  contextCountRun = countContext($, detail).finally(() => {
    contextCountRun = undefined
  })
  return contextCountRun
}

async function countContext($: EngineInterface, detail: 'full' | 'summary'): Promise<void> {
  await update($, isContextLoadingAtom, () => true)
  try {
    const counted = await readBreakdown($, detail)
    if (counted === undefined) {
      return
    }
    const view = toContextView(counted.breakdown, counted.isExact, await $.clock.now())
    await update($, contextViewAtom, () => view)
  } catch (error) {
    $.ui.toast(`usage-corner: could not count the context: ${String(error)}`)
  } finally {
    await update($, isContextLoadingAtom, () => false)
  }
}

async function readBreakdown($: EngineInterface, detail: 'full' | 'summary') {
  if (detail === 'full') {
    try {
      const breakdown = (await $.session.usage({ breakdown: 'full' })).context.breakdown
      if (breakdown !== undefined) {
        return { breakdown, isExact: true }
      }
    } catch (error) {
      $.ui.log(`usage-corner: exact context count failed, estimating instead: ${String(error)}`)
    }
  }
  const breakdown = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
  return breakdown === undefined ? undefined : { breakdown, isExact: false }
}

/** The panel tab last chosen. */
export async function readTab($: EngineInterface): Promise<PanelTab> {
  return read($, tabAtom)
}

/** Remembers the panel tab to show. */
export async function writeTab($: EngineInterface, tab: PanelTab): Promise<void> {
  await update($, tabAtom, () => tab)
}

/** Everything the panel draws from, read together. */
export async function readPanelState($: EngineInterface) {
  return {
    tab: await read($, tabAtom),
    snapshot: await read($, snapshotAtom),
    planUsage: await read($, planUsageAtom),
    activity: await read($, activityAtom),
    clockMinute: await read($, clockMinuteAtom),
    contextView: await read($, contextViewAtom),
    isContextLoading: await read($, isContextLoadingAtom),
    isPlanUsageLoading: await read($, isPlanUsageLoadingAtom),
  }
}
