import type { ContextCategoryRow, ContextSquare, LimitReading } from '../types'
import { ICON_FABLE, ICON_FIVE_HOUR, ICON_WEEK, MODEL_FAMILY_COLORS, colorForPercent, formatModelName } from './format'
import type { Segment } from './format'

/** A model the Model tab offers; `alias` is what `/model <alias>` takes. */
export type ModelChoice = { alias: string; modelId: string; color: string }

/** The models offered, newest family first. `/model <alias>` resolves each alias. */
export const MODEL_CHOICES: readonly ModelChoice[] = [
  { alias: 'opus', modelId: 'claude-opus-5-5', color: MODEL_FAMILY_COLORS.opus ?? 'text' },
  { alias: 'sonnet', modelId: 'claude-sonnet-5-5', color: MODEL_FAMILY_COLORS.sonnet ?? 'text' },
  { alias: 'haiku', modelId: 'claude-haiku-5-5', color: MODEL_FAMILY_COLORS.haiku ?? 'text' },
  { alias: 'fable', modelId: 'claude-fable-5-2', color: MODEL_FAMILY_COLORS.fable ?? 'text' },
]

/** Returns true when the session's model belongs to this choice's family (ignoring a `[1m]` suffix or date). */
export function isCurrentModel(choice: ModelChoice, currentModelId: string): boolean {
  return currentModelId.toLowerCase().includes(`claude-${choice.alias}-`)
}

/** The display name of a choice, e.g. `Opus 5.5`. */
export function choiceName(choice: ModelChoice): string {
  return formatModelName(choice.modelId)
}

const WIDE_FILLED = '█'
const WIDE_EMPTY = '░'

/** A long bar for the panel: `cells` wide, colored by how full it is. */
export function wideMeterSegments(percent: number, cells: number): Segment[] {
  const clampedPercent = Math.min(100, Math.max(0, percent))
  const filledCells = clampedPercent === 0 ? 0 : Math.max(1, Math.round((clampedPercent / 100) * cells))
  return [
    { text: WIDE_FILLED.repeat(filledCells), color: colorForPercent(clampedPercent) },
    { text: WIDE_EMPTY.repeat(cells - filledCells), color: 'subtle' },
  ]
}

/** How a limit window is titled in the Usage tab. */
export type LimitTitle = { icon: string; iconColor: string; title: string }

/** Titles a header-reported window for the Usage tab, or undefined for one it does not know. */
export function titleForLimit(limit: LimitReading): LimitTitle | undefined {
  if (limit.kind === 'five_hour') {
    return { icon: ICON_FIVE_HOUR, iconColor: 'warning', title: '5-hour limit' }
  }
  if (limit.kind === 'seven_day') {
    return { icon: ICON_WEEK, iconColor: 'suggestion', title: 'Weekly limit' }
  }
  if (limit.kind === 'spend_limit') {
    return { icon: ICON_WEEK, iconColor: 'warning', title: 'Spend limit' }
  }
  return undefined
}

/** Titles a model's own weekly window from `/usage` (e.g. Fable's). */
export function titleForModelWindow(name: string): LimitTitle {
  const color = MODEL_FAMILY_COLORS[name.toLowerCase()] ?? 'merged'
  return { icon: ICON_FABLE, iconColor: color, title: `${name} weekly limit` }
}

const MILLISECONDS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

/** How long the session has run: `12m`, `2h14m`. */
export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / MILLISECONDS_PER_MINUTE))
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (hours === 0) {
    return `${minutes}m`
  }
  return `${hours}h${minutes}m`
}

/** The glyph for one square of the context grid: full, partly full, or free. */
export function squareGlyph(square: ContextSquare): string {
  // /context draws a row's last square hollow under 70% full; this follows it.
  const PARTIAL_THRESHOLD = 0.7
  if (!square.isFilled) {
    return '□'
  }
  if (square.squareFullness < PARTIAL_THRESHOLD) {
    return '▪'
  }
  return '■'
}

/**
 * The category rows to list: what occupies the window first (largest first),
 * then free space and the compaction buffer, then deferred tools (outside the window).
 */
export function orderCategories(categories: readonly ContextCategoryRow[]): ContextCategoryRow[] {
  const kindOrder: Record<ContextCategoryRow['kind'], number> = { used: 0, free: 1, buffer: 2, deferred: 3 }
  return [...categories]
    .filter(category => category.tokens > 0)
    .sort((first, second) => {
      const kindDifference = kindOrder[first.kind] - kindOrder[second.kind]
      if (kindDifference !== 0) {
        return kindDifference
      }
      return second.tokens - first.tokens
    })
}

/** A category's share of the window, as `/context` prints it: `0.3%`, `12.1%`. */
export function formatShare(tokens: number, windowTokens: number): string {
  if (windowTokens <= 0) {
    return '0%'
  }
  const percent = (tokens / windowTokens) * 100
  return `${Number(percent.toFixed(1))}%`
}
