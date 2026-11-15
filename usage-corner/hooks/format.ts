import type { LimitReading, UsageSnapshot } from '../types'

/** One colored run of text in the corner. `color` is a theme key or hex color. */
export type Segment = { text: string; color?: string; isBold?: boolean; isDim?: boolean }

const TOKENS_PER_THOUSAND = 1000
const TOKENS_PER_MILLION = 1_000_000
const MILLISECONDS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

const BAR_CELLS = 5
const BAR_FILLED = '▰'
const BAR_EMPTY = '▱'
const WARNING_PERCENT = 50
const DANGER_PERCENT = 80

// Nerd Font (Material Design) icons; the terminal font is JetBrainsMono Nerd Font.
export const ICON_MODEL = '\u{F06A9}'     // robot
export const ICON_CONTEXT = '\u{F09D1}'   // brain
export const ICON_FIVE_HOUR = '\u{F051F}' // timer sand
export const ICON_WEEK = '\u{F0A33}'      // calendar week
export const ICON_FABLE = '\u{F0AE2}'     // four-point star
export const ICON_COST = '\u{F01C1}'      // dollar
const WIDE_SEPARATOR: Segment = { text: '  │  ', color: 'subtle' }
const NARROW_SEPARATOR: Segment = { text: ' │ ', color: 'subtle' }

/** Each model family gets its own color so a switch is noticed at a glance. */
export const MODEL_FAMILY_COLORS: Record<string, string> = {
  opus: 'claude',
  sonnet: 'suggestion',
  haiku: 'success',
  fable: 'merged',
}

/** Turns a model id such as `claude-opus-5-5[1m]` into `Opus 5.5`. */
export function formatModelName(modelId: string): string {
  const withoutContextSuffix = modelId.replace(/\[.*\]$/, '')
  const match = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/.exec(withoutContextSuffix)
  if (match === null) {
    return withoutContextSuffix
  }
  const family = match[1] ?? ''
  const major = match[2] ?? ''
  const minor = match[3]
  const familyName = family.charAt(0).toUpperCase() + family.slice(1)
  const version = minor === undefined ? major : `${major}.${minor}`
  return `${familyName} ${version}`
}

/** Writes a token count compactly: 950, 84k, 1M. */
export function formatTokenCount(tokenCount: number): string {
  if (tokenCount >= TOKENS_PER_MILLION) {
    const millions = tokenCount / TOKENS_PER_MILLION
    return `${Number(millions.toFixed(1))}M`
  }
  if (tokenCount >= TOKENS_PER_THOUSAND) {
    return `${Math.round(tokenCount / TOKENS_PER_THOUSAND)}k`
  }
  return String(tokenCount)
}

/** Writes the time until a reset compactly: 45m, 4h12m, 2d3h; empty when unknown or past. */
export function formatTimeUntil(resetsAt: string | undefined, nowMilliseconds: number): string {
  if (resetsAt === undefined) {
    return ''
  }
  const resetMilliseconds = Date.parse(resetsAt)
  if (Number.isNaN(resetMilliseconds) || resetMilliseconds <= nowMilliseconds) {
    return ''
  }
  const totalMinutes = Math.ceil((resetMilliseconds - nowMilliseconds) / MILLISECONDS_PER_MINUTE)
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

/** Green below half, yellow below 80%, red from 80%. */
export function colorForPercent(percent: number): string {
  if (percent >= DANGER_PERCENT) {
    return 'error'
  }
  if (percent >= WARNING_PERCENT) {
    return 'warning'
  }
  return 'success'
}

/**
 * How much the corner shows. Each step down drops the least useful detail,
 * so a narrow terminal still sees the percentages that matter.
 */
export type DetailLevel = {
  showTokenCounts: boolean
  showResetTimes: boolean
  showMeters: boolean
  showModelVersion: boolean
  showCost: boolean
  isNarrowSeparator: boolean
}

/** From the full corner down to percentages only; the first that fits is used. */
export const DETAIL_LEVELS: readonly DetailLevel[] = [
  { showTokenCounts: true, showResetTimes: true, showMeters: true, showModelVersion: true, showCost: true, isNarrowSeparator: false },
  { showTokenCounts: false, showResetTimes: true, showMeters: true, showModelVersion: true, showCost: true, isNarrowSeparator: false },
  { showTokenCounts: false, showResetTimes: false, showMeters: true, showModelVersion: true, showCost: true, isNarrowSeparator: true },
  { showTokenCounts: false, showResetTimes: false, showMeters: false, showModelVersion: true, showCost: true, isNarrowSeparator: true },
  { showTokenCounts: false, showResetTimes: false, showMeters: false, showModelVersion: false, showCost: true, isNarrowSeparator: true },
  { showTokenCounts: false, showResetTimes: false, showMeters: false, showModelVersion: false, showCost: false, isNarrowSeparator: true },
]

/** Draws a 5-cell meter (▰▰▱▱▱) plus the percentage, or the percentage alone; colored by how full it is. */
function meterSegments(percent: number, detail: DetailLevel): Segment[] {
  const clampedPercent = Math.min(100, Math.max(0, percent))
  const color = colorForPercent(clampedPercent)
  const percentSegment: Segment = { text: `${Math.round(percent)}%`, color, isBold: true }
  if (!detail.showMeters) {
    return [percentSegment]
  }
  // Any use at all lights the first cell, so 3% does not look like 0%.
  const filledCells = clampedPercent === 0 ? 0 : Math.max(1, Math.round((clampedPercent / 100) * BAR_CELLS))
  return [
    { text: BAR_FILLED.repeat(filledCells), color },
    { text: BAR_EMPTY.repeat(BAR_CELLS - filledCells) + ' ', color: 'subtle' },
    percentSegment,
  ]
}

function modelSegments(modelId: string, detail: DetailLevel): Segment[] {
  const fullName = formatModelName(modelId)
  const familyName = fullName.split(' ')[0] ?? fullName
  const color = MODEL_FAMILY_COLORS[familyName.toLowerCase()] ?? 'text'
  const name = detail.showModelVersion ? fullName : familyName
  return [{ text: `${ICON_MODEL} ${name}`, color, isBold: true }]
}

function contextSegments(snapshot: UsageSnapshot, detail: DetailLevel): Segment[] {
  const windowText = formatTokenCount(snapshot.contextWindow)
  const icon: Segment = { text: `${ICON_CONTEXT} `, color: 'suggestion' }
  if (snapshot.contextTokens === undefined || snapshot.contextPercent === undefined) {
    return [icon, { text: windowText, isDim: true }]
  }
  const segments = [icon, ...meterSegments(snapshot.contextPercent, detail)]
  if (detail.showTokenCounts) {
    segments.push({ text: ` ${formatTokenCount(snapshot.contextTokens)}/${windowText}`, isDim: true })
  }
  return segments
}

type LimitStyle = { icon: string; iconColor: string; label: string }

function limitSegments(style: LimitStyle, limit: LimitReading, nowMilliseconds: number, detail: DetailLevel): Segment[] {
  const segments: Segment[] = [
    { text: `${style.icon} `, color: style.iconColor },
    { text: `${style.label} `, isDim: true },
    ...meterSegments(limit.percentUsed, detail),
  ]
  const resetText = detail.showResetTimes ? formatTimeUntil(limit.resetsAt, nowMilliseconds) : ''
  if (resetText !== '') {
    segments.push({ text: ` ↻${resetText}`, isDim: true })
  }
  return segments
}

const FIVE_HOUR_STYLE: LimitStyle = { icon: ICON_FIVE_HOUR, iconColor: 'warning', label: '5h' }
const WEEK_STYLE: LimitStyle = { icon: ICON_WEEK, iconColor: 'suggestion', label: 'wk' }
const SPEND_STYLE: LimitStyle = { icon: ICON_COST, iconColor: 'warning', label: 'spend' }

/** Model-scoped weekly windows are stored as `seven_day_<family>` (e.g. `seven_day_fable`). */
export const MODEL_WINDOW_KIND_PREFIX = 'seven_day_'

/** Returns how a window is drawn, or undefined when it should stay hidden. */
function styleForLimit(kind: string, modelId: string): LimitStyle | undefined {
  if (kind === 'five_hour') {
    return FIVE_HOUR_STYLE
  }
  if (kind === 'seven_day') {
    return WEEK_STYLE
  }
  if (kind === 'spend_limit') {
    return SPEND_STYLE
  }
  if (!kind.startsWith(MODEL_WINDOW_KIND_PREFIX)) {
    return undefined
  }
  // A model's own weekly window (Fable's) matters only while that model is in use.
  const family = kind.slice(MODEL_WINDOW_KIND_PREFIX.length)
  if (!modelId.toLowerCase().includes(`claude-${family}`)) {
    return undefined
  }
  const label = family.charAt(0).toUpperCase() + family.slice(1)
  return { icon: ICON_FABLE, iconColor: MODEL_FAMILY_COLORS[family] ?? 'merged', label }
}

function allLimitGroups(limits: LimitReading[], modelId: string, nowMilliseconds: number, detail: DetailLevel): Segment[][] {
  const groups: Segment[][] = []
  for (const limit of limits) {
    const style = styleForLimit(limit.kind, modelId)
    if (style !== undefined) {
      groups.push(limitSegments(style, limit, nowMilliseconds, detail))
    }
  }
  return groups
}

function costSegments(costUsd: number): Segment[] {
  return [{ text: `${ICON_COST}${costUsd.toFixed(2)}`, color: 'success', isBold: true }]
}

/** What pressing a part of the corner opens: the built-in slash command of that name. */
export type CornerAction = 'model' | 'context' | 'usage'

/** One pressable part of the corner (the model, the context meter, one limit, the cost). */
export type UsageGroup = { key: string; action: CornerAction; segments: Segment[] }

/** The corner laid out: its pressable groups and the bar drawn between them. */
export type UsageLayout = { groups: UsageGroup[]; separator: Segment }

/** Builds the corner at one detail level. Limits and cost both open the usage view. */
export function buildUsageLayout(snapshot: UsageSnapshot, nowMilliseconds: number, detail: DetailLevel = DETAIL_LEVELS[0]!): UsageLayout {
  const groups: UsageGroup[] = [
    { key: 'model', action: 'model', segments: modelSegments(snapshot.model, detail) },
    { key: 'context', action: 'context', segments: contextSegments(snapshot, detail) },
  ]
  const limitGroups = allLimitGroups(snapshot.limits, snapshot.model, nowMilliseconds, detail)
  for (const [index, segments] of limitGroups.entries()) {
    groups.push({ key: `limit-${index}`, action: 'usage', segments })
  }
  if (detail.showCost && snapshot.costUsd !== undefined) {
    groups.push({ key: 'cost', action: 'usage', segments: costSegments(snapshot.costUsd) })
  }
  const separator = detail.isNarrowSeparator ? NARROW_SEPARATOR : WIDE_SEPARATOR
  return { groups, separator }
}

/** Flattens a layout into one run of segments, separators included, as it is drawn. */
export function layoutToSegments(layout: UsageLayout): Segment[] {
  const segments: Segment[] = []
  for (const [index, group] of layout.groups.entries()) {
    if (index > 0) {
      segments.push(layout.separator)
    }
    segments.push(...group.segments)
  }
  return segments
}

/**
 * Counts the terminal cells a run of segments takes. Every character used
 * here (letters, ▰ ▱ │ ↻ and the Nerd Font icons) is one cell wide, so one
 * code point is one cell; spreading the string counts astral icons once.
 */
export function measureCells(segments: Segment[]): number {
  return [...segmentsToPlainText(segments)].length
}

/** Builds the most detailed corner that fits in `maxCells`, or the smallest one when none does. */
export function fitUsageLayout(snapshot: UsageSnapshot, nowMilliseconds: number, maxCells: number): UsageLayout {
  let layout = buildUsageLayout(snapshot, nowMilliseconds)
  for (const detail of DETAIL_LEVELS) {
    layout = buildUsageLayout(snapshot, nowMilliseconds, detail)
    if (measureCells(layoutToSegments(layout)) <= maxCells) {
      return layout
    }
  }
  return layout
}

/** The corner as plain text, for tests and logs. */
export function segmentsToPlainText(segments: Segment[]): string {
  return segments.map(segment => segment.text).join('')
}
