import type { LimitReading, PlanUsage, PlanWindow, UsageSnapshot } from '../types'
import { FIVE_HOUR_KIND, MODEL_WINDOW_KIND_PREFIX, WEEK_KIND } from './plan-usage'

/** One limit window ready to draw: the freshest reading of it from the headers or `/usage`. */
export type LimitView = {
  kind: string
  title: string
  percentUsed: number
  /** When it resets, in clock milliseconds; absent when unknown or already past. */
  resetsAtMilliseconds?: number
  /** The reset as `/usage` printed it (`Nov 17, 10pm`), for when the moment is unknown; else ''. */
  resetText: string
  /** True when the reset time has passed and no newer reading has arrived: the old figure no longer holds. */
  hasReset: boolean
}

export const SPEND_LIMIT_KIND = 'spend_limit'

const MILLISECONDS_PER_MINUTE = 60_000
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE
const FIVE_HOUR_WINDOW_MILLISECONDS = 5 * MILLISECONDS_PER_HOUR
const WEEK_WINDOW_MILLISECONDS = 7 * 24 * MILLISECONDS_PER_HOUR

/** Returns the model family a window belongs to (`fable` for `seven_day_fable`), or undefined for an account-wide one. */
export function modelFamilyOfWindow(kind: string): string | undefined {
  if (!kind.startsWith(MODEL_WINDOW_KIND_PREFIX)) {
    return undefined
  }
  return kind.slice(MODEL_WINDOW_KIND_PREFIX.length)
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The window's name in full: `5-hour limit`, `Fable weekly limit`. */
export function titleForKind(kind: string, planName?: string): string {
  if (kind === FIVE_HOUR_KIND) {
    return '5-hour limit'
  }
  if (kind === WEEK_KIND) {
    return 'Weekly limit'
  }
  if (kind === SPEND_LIMIT_KIND) {
    return 'Spend limit'
  }
  const family = modelFamilyOfWindow(kind)
  if (family !== undefined) {
    return `${planName ?? capitalize(family)} weekly limit`
  }
  return kind
}

/** Where a window stands in the corner: 5h, weekly, a model's weekly, spend, then anything new. */
function rankOfKind(kind: string): number {
  if (kind === FIVE_HOUR_KIND) {
    return 0
  }
  if (kind === WEEK_KIND) {
    return 1
  }
  if (modelFamilyOfWindow(kind) !== undefined) {
    return 2
  }
  if (kind === SPEND_LIMIT_KIND) {
    return 3
  }
  return 4
}

function parseIsoTime(isoTime: string | undefined): number | undefined {
  if (isoTime === undefined) {
    return undefined
  }
  const milliseconds = Date.parse(isoTime)
  return Number.isNaN(milliseconds) ? undefined : milliseconds
}

type Reading = { percentUsed: number; resetsAtMilliseconds?: number; resetText: string; planName?: string }

/** Picks the fresher of a header reading and a `/usage` reading of the same window. */
function pickReading(
  header: LimitReading | undefined,
  plan: PlanWindow | undefined,
  isPlanNewer: boolean,
): Reading | undefined {
  const headerReset = parseIsoTime(header?.resetsAt)
  if (plan !== undefined && (header === undefined || isPlanNewer)) {
    return {
      percentUsed: plan.percentUsed,
      resetsAtMilliseconds: plan.resetsAtMilliseconds ?? headerReset,
      resetText: plan.resetText,
      planName: plan.name,
    }
  }
  if (header === undefined) {
    return undefined
  }
  return { percentUsed: header.percentUsed, resetsAtMilliseconds: headerReset, resetText: plan?.resetText ?? '', planName: plan?.name }
}

/**
 * Merges the two sources of limit figures into the list to draw. The headers
 * are as fresh as this session's last reply; `/usage` is as fresh as its last
 * run and also knows each model's own window. Per window the newer one wins.
 * A reading whose reset time has passed is shown as 0% and marked `hasReset`.
 */
export function mergeLimits(snapshot: UsageSnapshot, planUsage: PlanUsage | null, nowMilliseconds: number): LimitView[] {
  const planWindows = planUsage?.windows ?? []
  const isPlanNewer = planUsage !== null && planUsage.fetchedAt > snapshot.limitsReadAt
  const kinds = new Set([...snapshot.limits.map(limit => limit.kind), ...planWindows.map(window => window.kind)])

  const views: LimitView[] = []
  for (const kind of kinds) {
    const header = snapshot.limits.find(limit => limit.kind === kind)
    const plan = planWindows.find(window => window.kind === kind)
    const reading = pickReading(header, plan, isPlanNewer)
    if (reading === undefined) {
      continue
    }
    const title = titleForKind(kind, modelFamilyOfWindow(kind) === undefined ? undefined : reading.planName)
    const hasReset = reading.resetsAtMilliseconds !== undefined && reading.resetsAtMilliseconds <= nowMilliseconds
    if (hasReset) {
      views.push({ kind, title, percentUsed: 0, resetText: '', hasReset: true })
      continue
    }
    const view: LimitView = { kind, title, percentUsed: reading.percentUsed, resetText: reading.resetText, hasReset: false }
    if (reading.resetsAtMilliseconds !== undefined) {
      view.resetsAtMilliseconds = reading.resetsAtMilliseconds
    }
    views.push(view)
  }
  return views.sort((first, second) => rankOfKind(first.kind) - rankOfKind(second.kind))
}

/** How long a window lasts from one reset to the next, or undefined for one without a fixed length. */
function windowLengthOf(kind: string): number | undefined {
  if (kind === FIVE_HOUR_KIND) {
    return FIVE_HOUR_WINDOW_MILLISECONDS
  }
  if (kind === WEEK_KIND || modelFamilyOfWindow(kind) !== undefined) {
    return WEEK_WINDOW_MILLISECONDS
  }
  return undefined
}

/** Writes a span compactly, rounding up: 45m, 4h12m, 2d3h. */
export function formatSpan(milliseconds: number): string {
  const MINUTES_PER_HOUR = 60
  const HOURS_PER_DAY = 24
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / MILLISECONDS_PER_MINUTE))
  const totalHours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (totalHours === 0) {
    return `${minutes}m`
  }
  const days = Math.floor(totalHours / HOURS_PER_DAY)
  const hours = totalHours % HOURS_PER_DAY
  if (days === 0) {
    return `${hours}h${minutes}m`
  }
  return `${days}d${hours}h`
}

/** Where the current rate of use leads: out before the reset, or some percentage at it. */
export type Pace = { isRunningOut: boolean; text: string }

/**
 * Projects a window's use forward at the average rate since it opened.
 * Returns undefined when there is nothing useful to say: an unknown reset or
 * window length, a window that only just opened, or one already empty or full.
 */
export function describePace(
  limit: Pick<LimitView, 'kind' | 'percentUsed' | 'resetsAtMilliseconds'>,
  nowMilliseconds: number,
): Pace | undefined {
  // In the first 5% of a window one burst of work would project absurdly.
  const MINIMUM_ELAPSED_SHARE = 0.05
  const windowLength = windowLengthOf(limit.kind)
  if (windowLength === undefined || limit.resetsAtMilliseconds === undefined) {
    return undefined
  }
  const timeLeft = limit.resetsAtMilliseconds - nowMilliseconds
  const elapsed = windowLength - timeLeft
  const isTooEarly = elapsed < windowLength * MINIMUM_ELAPSED_SHARE
  if (timeLeft <= 0 || isTooEarly || limit.percentUsed <= 0 || limit.percentUsed >= 100) {
    return undefined
  }
  const percentPerMillisecond = limit.percentUsed / elapsed
  const timeUntilFull = (100 - limit.percentUsed) / percentPerMillisecond
  if (timeUntilFull < timeLeft) {
    return { isRunningOut: true, text: `at this pace: used up in ${formatSpan(timeUntilFull)}, before the reset` }
  }
  const percentAtReset = Math.round(limit.percentUsed + percentPerMillisecond * timeLeft)
  return { isRunningOut: false, text: `at this pace: about ${percentAtReset}% by the reset` }
}
