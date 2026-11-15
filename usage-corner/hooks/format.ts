import type { UsageSnapshot } from '../types'
import { SPEND_LIMIT_KIND, formatSpan, modelFamilyOfWindow } from './limits'
import type { LimitView } from './limits'
import { FIVE_HOUR_KIND, WEEK_KIND } from './plan-usage'

/** One colored run of text in the corner. `color` is a theme key or hex color. */
export type Segment = { text: string; color?: string; isBold?: boolean; isDim?: boolean }

const TOKENS_PER_THOUSAND = 1000
const TOKENS_PER_MILLION = 1_000_000

const BAR_CELLS = 5
const BAR_FILLED = '▰'
const BAR_EMPTY = '▱'
const WARNING_PERCENT = 50
const DANGER_PERCENT = 80

/** The glyph in front of each part of the corner. */
export type IconSet = {
  model: string
  context: string
  fiveHour: string
  week: string
  modelWindow: string
  /** Drawn right against the amount: a dollar glyph. */
  cost: string
  refresh: string
  usage: string
}

/** Nerd Font (Material Design) icons, for terminals whose font has them. */
const NERD_ICONS: IconSet = {
  model: '\u{F06A9}',       // robot
  context: '\u{F09D1}',     // brain
  fiveHour: '\u{F051F}',    // timer sand
  week: '\u{F0A33}',        // calendar week
  modelWindow: '\u{F0AE2}', // four-point star
  cost: '\u{F01C1}',        // dollar
  refresh: '\u{F0450}',     // refresh
  usage: '\u{F01DE}',       // donut chart
}

/** Plain symbols every monospace font draws one cell wide. */
const UNICODE_ICONS: IconSet = {
  model: '◆', context: '◔', fiveHour: '◷', week: '▤', modelWindow: '✦', cost: '$', refresh: '↻', usage: '◕',
}

/** Returns the icons for the chosen style. */
export function iconsFor(iconStyle: 'nerd' | 'unicode'): IconSet {
  return iconStyle === 'unicode' ? UNICODE_ICONS : NERD_ICONS
}

const WIDE_SEPARATOR: Segment = { text: '  │  ', color: 'subtle' }
const NARROW_SEPARATOR: Segment = { text: ' │ ', color: 'subtle' }

/** Each model family gets its own color so a switch is noticed at a glance. */
export const MODEL_FAMILY_COLORS: Record<string, string> = {
  opus: 'claude',
  sonnet: 'suggestion',
  haiku: 'success',
  fable: 'merged',
}

const MODEL_ID_PATTERN = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-|$)/

/** Returns a model's family in lower case (`opus` for `claude-opus-5-5[1m]`), or undefined for an id of another form. */
export function modelFamilyOf(modelId: string): string | undefined {
  return MODEL_ID_PATTERN.exec(modelId.toLowerCase())?.[1]
}

/** Turns a model id such as `claude-opus-5-5[1m]` into `Opus 5.5`. */
export function formatModelName(modelId: string): string {
  const withoutContextSuffix = modelId.replace(/\[.*\]$/, '')
  const match = MODEL_ID_PATTERN.exec(withoutContextSuffix)
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
  const thousands = Math.round(tokenCount / TOKENS_PER_THOUSAND)
  // 999 600 rounds to 1000k, which reads better as 1M.
  if (thousands >= TOKENS_PER_THOUSAND) {
    const millions = tokenCount / TOKENS_PER_MILLION
    return `${Number(millions.toFixed(1))}M`
  }
  if (tokenCount >= TOKENS_PER_THOUSAND) {
    return `${thousands}k`
  }
  return String(tokenCount)
}

/** Writes a cost in dollars: cents below $100, whole dollars above. */
export function formatCost(costUsd: number): string {
  const WHOLE_DOLLARS_FROM = 100
  return costUsd >= WHOLE_DOLLARS_FROM ? String(Math.round(costUsd)) : costUsd.toFixed(2)
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
  showEffort: boolean
  showMeters: boolean
  showModelVersion: boolean
  showCost: boolean
  isNarrowSeparator: boolean
}

const FULL_DETAIL: DetailLevel = {
  showTokenCounts: true, showResetTimes: true, showEffort: true, showMeters: true, showModelVersion: true, showCost: true,
  isNarrowSeparator: false,
}

// What each step down gives up, the cheapest loss first. A step keeps
// everything the steps before it dropped.
const DETAIL_DROPS: readonly Partial<DetailLevel>[] = [
  { isNarrowSeparator: true },
  { showTokenCounts: false },
  { showResetTimes: false },
  { showEffort: false },
  { showMeters: false },
  { showModelVersion: false },
  { showCost: false },
]

function buildDetailLevels(): DetailLevel[] {
  const levels: DetailLevel[] = [FULL_DETAIL]
  let current = FULL_DETAIL
  for (const drop of DETAIL_DROPS) {
    current = { ...current, ...drop }
    levels.push(current)
  }
  return levels
}

/** From the full corner down to percentages only; the first that fits is used. */
export const DETAIL_LEVELS: readonly DetailLevel[] = buildDetailLevels()

/** What the corner is drawn from. */
export type CornerData = {
  snapshot: UsageSnapshot
  /** The limit windows, already merged from the headers and `/usage` (mergeLimits). */
  limits: readonly LimitView[]
  nowMilliseconds: number
  iconStyle: 'nerd' | 'unicode'
  isCostShown: boolean
}

/** Draws a 5-cell meter (▰▰▱▱▱) plus the percentage, or the percentage alone; colored by how full it is. */
function meterSegments(percent: number, detail: DetailLevel, isEstimate = false): Segment[] {
  const clampedPercent = Math.min(100, Math.max(0, percent))
  const color = colorForPercent(clampedPercent)
  const percentText = `${isEstimate ? '~' : ''}${Math.round(percent)}%`
  const percentSegment: Segment = { text: percentText, color, isBold: true }
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

function modelSegments(snapshot: UsageSnapshot, icons: IconSet, detail: DetailLevel): Segment[] {
  const fullName = formatModelName(snapshot.model)
  const familyName = fullName.split(' ')[0] ?? fullName
  const color = MODEL_FAMILY_COLORS[familyName.toLowerCase()] ?? 'text'
  const name = detail.showModelVersion ? fullName : familyName
  const segments: Segment[] = [{ text: `${icons.model} ${name}`, color, isBold: true }]
  if (!detail.showEffort) {
    return segments
  }
  // A fallback answered in place of the chosen model (overload, a limit): say which.
  const answeringName = snapshot.answeringModel === undefined ? fullName : formatModelName(snapshot.answeringModel)
  if (answeringName !== fullName) {
    segments.push({ text: ` → ${answeringName}`, color: 'warning' })
  }
  if (snapshot.effort !== undefined) {
    segments.push({ text: ` · ${snapshot.effort}`, isDim: true })
  }
  return segments
}

function contextSegments(snapshot: UsageSnapshot, icons: IconSet, detail: DetailLevel): Segment[] {
  const windowText = formatTokenCount(snapshot.contextWindow)
  const icon: Segment = { text: `${icons.context} `, color: 'suggestion' }
  if (snapshot.contextTokens === undefined || snapshot.contextPercent === undefined) {
    return [icon, { text: windowText, isDim: true }]
  }
  const segments = [icon, ...meterSegments(snapshot.contextPercent, detail, snapshot.isContextEstimated)]
  if (detail.showTokenCounts) {
    const estimateMark = snapshot.isContextEstimated ? '~' : ''
    segments.push({ text: ` ${estimateMark}${formatTokenCount(snapshot.contextTokens)}/${windowText}`, isDim: true })
  }
  return segments
}

type LimitStyle = { icon: string; iconColor: string; label: string }

/** Returns how a window is drawn in the corner, or undefined when it should stay out of it. */
function styleForLimit(kind: string, modelId: string, icons: IconSet): LimitStyle | undefined {
  if (kind === FIVE_HOUR_KIND) {
    return { icon: icons.fiveHour, iconColor: 'warning', label: '5h' }
  }
  if (kind === WEEK_KIND) {
    return { icon: icons.week, iconColor: 'suggestion', label: 'wk' }
  }
  if (kind === SPEND_LIMIT_KIND) {
    return { icon: icons.cost, iconColor: 'warning', label: 'spend' }
  }
  // A model's own weekly window (Fable's) matters only while that model is in use.
  const family = modelFamilyOfWindow(kind)
  if (family === undefined || modelFamilyOf(modelId) !== family) {
    return undefined
  }
  const label = family.charAt(0).toUpperCase() + family.slice(1)
  return { icon: icons.modelWindow, iconColor: MODEL_FAMILY_COLORS[family] ?? 'merged', label }
}

function limitSegments(style: LimitStyle, limit: LimitView, nowMilliseconds: number, detail: DetailLevel): Segment[] {
  const segments: Segment[] = [
    { text: `${style.icon} `, color: style.iconColor },
    { text: `${style.label} `, isDim: true },
    ...meterSegments(limit.percentUsed, detail),
  ]
  if (!detail.showResetTimes) {
    return segments
  }
  if (limit.hasReset) {
    segments.push({ text: ' reset', isDim: true })
  } else if (limit.resetsAtMilliseconds !== undefined) {
    segments.push({ text: ` ↻${formatSpan(limit.resetsAtMilliseconds - nowMilliseconds)}`, isDim: true })
  }
  return segments
}

/** Which tab of the panel a part of the corner opens. */
export type CornerAction = 'model' | 'context' | 'usage'

/** One pressable part of the corner (the model, the context meter, one limit, the cost). */
export type UsageGroup = { key: string; action: CornerAction; segments: Segment[] }

/** The corner laid out: its pressable groups and the bar drawn between them. */
export type UsageLayout = { groups: UsageGroup[]; separator: Segment }

/** Builds the corner at one detail level. Limits and cost both open the usage view. */
export function buildUsageLayout(data: CornerData, detail: DetailLevel = FULL_DETAIL): UsageLayout {
  const { snapshot, nowMilliseconds } = data
  const icons = iconsFor(data.iconStyle)
  const groups: UsageGroup[] = [
    { key: 'model', action: 'model', segments: modelSegments(snapshot, icons, detail) },
    { key: 'context', action: 'context', segments: contextSegments(snapshot, icons, detail) },
  ]
  for (const limit of data.limits) {
    const style = styleForLimit(limit.kind, snapshot.model, icons)
    if (style !== undefined) {
      groups.push({ key: `limit-${limit.kind}`, action: 'usage', segments: limitSegments(style, limit, nowMilliseconds, detail) })
    }
  }
  if (data.isCostShown && detail.showCost && snapshot.costUsd !== undefined) {
    const costSegment: Segment = { text: `${icons.cost}${formatCost(snapshot.costUsd)}`, color: 'success', isBold: true }
    groups.push({ key: 'cost', action: 'usage', segments: [costSegment] })
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

/** The corner as plain text, for tests and logs. */
export function segmentsToPlainText(segments: Segment[]): string {
  return segments.map(segment => segment.text).join('')
}

/**
 * Counts the terminal cells a run of segments takes. Every character used
 * here (letters, ▰ ▱ │ ↻ and the icons) is one cell wide, so one code point
 * is one cell; spreading the string counts astral icons once.
 */
export function measureCells(segments: Segment[]): number {
  return [...segmentsToPlainText(segments)].length
}

/** Builds the most detailed corner that fits in `maxCells`, or the smallest one when none does. */
export function fitUsageLayout(data: CornerData, maxCells: number): UsageLayout {
  let layout = buildUsageLayout(data)
  for (const detail of DETAIL_LEVELS) {
    layout = buildUsageLayout(data, detail)
    if (measureCells(layoutToSegments(layout)) <= maxCells) {
      return layout
    }
  }
  return layout
}
