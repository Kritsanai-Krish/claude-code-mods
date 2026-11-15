import type { SessionContextBreakdown } from 'claude-code'
import type { ContextCategoryRow, ContextItem, ContextSquare, ContextView } from '../types'
import { MODEL_FAMILY_COLORS, colorForPercent, formatModelName, modelFamilyOf } from './format'
import type { IconSet, Segment } from './format'
import { SPEND_LIMIT_KIND, formatSpan, modelFamilyOfWindow } from './limits'
import type { LimitView } from './limits'
import { FIVE_HOUR_KIND } from './plan-usage'

/** A model the Model tab offers; `alias` is what `/model <alias>` takes. */
export type ModelChoice = { alias: string; modelId: string; color: string }

/** The models offered, in the order `/model` lists them. `/model <alias>` resolves each alias. */
export const MODEL_CHOICES: readonly ModelChoice[] = [
  { alias: 'opus', modelId: 'claude-opus-5-5', color: MODEL_FAMILY_COLORS.opus ?? 'text' },
  { alias: 'fable', modelId: 'claude-fable-5-2', color: MODEL_FAMILY_COLORS.fable ?? 'text' },
  { alias: 'sonnet', modelId: 'claude-sonnet-5-5', color: MODEL_FAMILY_COLORS.sonnet ?? 'text' },
  { alias: 'haiku', modelId: 'claude-haiku-5-5', color: MODEL_FAMILY_COLORS.haiku ?? 'text' },
]

/** The effort levels `/effort <level>` takes, lowest first. */
export const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']

/** Returns true when the session's model belongs to this choice's family (ignoring a `[1m]` suffix or date). */
export function isCurrentModel(choice: ModelChoice, currentModelId: string): boolean {
  return modelFamilyOf(currentModelId) === choice.alias
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

/** The icon and its color in front of a limit's title in the Usage tab. */
export function iconForLimit(kind: string, icons: IconSet): { icon: string; color: string } {
  if (kind === FIVE_HOUR_KIND) {
    return { icon: icons.fiveHour, color: 'warning' }
  }
  if (kind === SPEND_LIMIT_KIND) {
    return { icon: icons.cost, color: 'warning' }
  }
  const family = modelFamilyOfWindow(kind)
  if (family !== undefined) {
    return { icon: icons.modelWindow, color: MODEL_FAMILY_COLORS[family] ?? 'merged' }
  }
  return { icon: icons.week, color: 'suggestion' }
}

/** Says when a limit resets: a countdown when the moment is known, else the time as `/usage` printed it. */
export function describeReset(limit: LimitView, nowMilliseconds: number): string {
  if (limit.hasReset) {
    return 'has reset · waiting for a new reading'
  }
  if (limit.resetsAtMilliseconds !== undefined) {
    return `resets in ${formatSpan(limit.resetsAtMilliseconds - nowMilliseconds)}`
  }
  return limit.resetText === '' ? '' : `resets ${limit.resetText}`
}

const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60

/** How long something took or has run: `7s`, `12m`, `2h14m`. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / MILLISECONDS_PER_SECOND))
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds}s`
  }
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  const minutes = totalMinutes % MINUTES_PER_HOUR
  if (hours === 0) {
    return `${minutes}m`
  }
  return `${hours}h${minutes}m`
}

/** How long ago a reading was taken: `just now`, `45s ago`, `5m ago`. */
export function formatAge(milliseconds: number): string {
  const JUST_NOW_MILLISECONDS = 10_000
  if (milliseconds < JUST_NOW_MILLISECONDS) {
    return 'just now'
  }
  return `${formatDuration(milliseconds)} ago`
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

const MAX_LARGEST_ITEMS = 6

function splitPath(path: string): { folder: string; fileName: string } {
  const lastSlash = path.lastIndexOf('/')
  return { folder: path.slice(0, Math.max(lastSlash, 0)), fileName: path.slice(lastSlash + 1) }
}

/** Sums each MCP server's loaded tool schemas: a server is switched off as a whole, so that is the useful unit. */
function mcpServerItems(tools: SessionContextBreakdown['mcpTools']): ContextItem[] {
  const servers = new Map<string, { tokens: number; toolCount: number }>()
  for (const tool of tools) {
    if (!tool.isLoaded) {
      continue
    }
    const server = servers.get(tool.serverName) ?? { tokens: 0, toolCount: 0 }
    servers.set(tool.serverName, { tokens: server.tokens + tool.tokens, toolCount: server.toolCount + 1 })
  }
  return [...servers].map(([serverName, server]) => ({
    label: serverName,
    detail: `MCP server · ${server.toolCount} ${server.toolCount === 1 ? 'tool' : 'tools'}`,
    tokens: server.tokens,
  }))
}

/** Lists what takes the most room in the context and could be trimmed: memory files, MCP servers, agents, listings. */
function findLargestItems(breakdown: SessionContextBreakdown): ContextItem[] {
  const items: ContextItem[] = mcpServerItems(breakdown.mcpTools)
  for (const file of breakdown.memoryFiles) {
    const { folder, fileName } = splitPath(file.path)
    items.push({ label: fileName, detail: `${file.type} memory · ${folder}`, tokens: file.tokens })
  }
  for (const agent of breakdown.agents) {
    items.push({ label: agent.agentType, detail: `agent · ${agent.source}`, tokens: agent.tokens })
  }
  if (breakdown.skills !== undefined) {
    const { includedSkills, totalSkills, tokens } = breakdown.skills
    items.push({ label: 'Skill list', detail: `${includedSkills} of ${totalSkills} skills`, tokens })
  }
  if (breakdown.slashCommands !== undefined) {
    const { includedCommands, totalCommands, tokens } = breakdown.slashCommands
    items.push({ label: 'Command list', detail: `${includedCommands} of ${totalCommands} commands`, tokens })
  }
  return items
    .filter(item => item.tokens > 0)
    .sort((first, second) => second.tokens - first.tokens)
    .slice(0, MAX_LARGEST_ITEMS)
}

/** Copies the fields of the engine's breakdown that the Context tab draws. */
export function toContextView(breakdown: SessionContextBreakdown, isExact: boolean, countedAt: number): ContextView {
  const view: ContextView = {
    model: breakdown.model,
    categories: breakdown.categories.map(category => ({
      name: category.name,
      tokens: category.tokens,
      color: category.color,
      kind: category.kind,
    })),
    gridRows: breakdown.gridRows.map(row => row.map(square => ({
      color: square.color,
      isFilled: square.isFilled,
      squareFullness: square.squareFullness,
    }))),
    largestItems: findLargestItems(breakdown),
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.maxTokens,
    percentage: breakdown.percentage,
    isExact,
    countedAt,
  }
  if (breakdown.autoCompactThreshold !== undefined) {
    view.autoCompactThreshold = breakdown.autoCompactThreshold
  }
  return view
}
