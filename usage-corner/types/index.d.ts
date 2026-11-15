/** One rate-limit window as the API's response headers report it. */
export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

/** Everything the corner is built from, read from the engine in one go. */
export type UsageSnapshot = {
  model: string
  /** The model that answered the last main-loop request; differs from `model` after a fallback. */
  answeringModel?: string
  /** Reasoning effort in force (`low` … `max`); absent on a model without effort or before it is known. */
  effort?: string
  /** The effort the settings file held for this model at the last read, to notice when it changes. */
  settingsEffort?: string
  startedAt: number
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  /** True when the context figures are a local estimate: a new or just-compacted session has no API count yet. */
  isContextEstimated: boolean
  costUsd?: number
  limits: LimitReading[]
  /** When a model response last confirmed `limits`, in clock milliseconds. */
  limitsReadAt: number
}

/** One limit window as `/usage` prints it: `Current week (Fable): 49% used · resets Nov 17, 10pm`. */
export type PlanWindow = {
  /** `five_hour`, `seven_day`, or `seven_day_<model>` for a model's own weekly window. */
  kind: string
  /** The name in the line: `session`, `all models`, `Fable`. */
  name: string
  percentUsed: number
  /** The reset as printed, without the time zone: `Nov 17, 10pm`. */
  resetText: string
  /** The reset as clock milliseconds, when the text could be parsed. */
  resetsAtMilliseconds?: number
}

/** One "what used your limits" block of `/usage`: `Last 24h · 529 requests · 15 sessions` and its lines. */
export type ContributorBlock = { title: string; lines: string[] }

/** What `claude -p /usage` reports: fresh figures for every window and what used them. */
export type PlanUsage = {
  windows: PlanWindow[]
  contributorBlocks: ContributorBlock[]
  fetchedAt: number
}

/** The four token counts the API reports for a response. */
export type TokenTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** The last finished main-loop turn. */
export type TurnSummary = TokenTotals & {
  durationMilliseconds: number
  /** `answer`, `aborted`, `refusal` or `error`. */
  endReason: string
  model?: string
}

/** What this session has spent in tokens, subagents included, since it began or was cleared. */
export type SessionActivity = {
  /** Turns of the main loop: one per prompt the person sent. */
  turnCount: number
  /** Runs of subagents; their tokens are in `totals` too. */
  subagentRunCount: number
  totals: TokenTotals
  lastTurn?: TurnSummary
}

/** The three tabs of the popup panel. */
export type PanelTab = 'model' | 'context' | 'usage'

/** One category row of the context breakdown (a copy of the engine's ContextCategory fields the panel uses). */
export type ContextCategoryRow = {
  name: string
  tokens: number
  /** Theme color key the engine draws this category in. */
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

/** One square of the context grid (the engine's ContextGridSquare fields the panel uses). */
export type ContextSquare = { color: string; isFilled: boolean; squareFullness: number }

/** One thing that takes room in the context: a memory file, an MCP server's tools, the skill listing. */
export type ContextItem = { label: string; detail: string; tokens: number }

/** The context window broken down by category, as the Context tab draws it. */
export type ContextView = {
  model: string
  categories: ContextCategoryRow[]
  gridRows: ContextSquare[][]
  /** The largest memory files, MCP servers, agents and listings, biggest first. */
  largestItems: ContextItem[]
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactThreshold?: number
  /** True when counted with the token-count API (as /context does), false for the local estimate. */
  isExact: boolean
  countedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-corner': {
      snapshot: Shaped<UsageSnapshot | null>
      planUsage: Shaped<PlanUsage | null>
      activity: Shaped<SessionActivity>
      /** The current minute (clock milliseconds / 60 000), so countdowns redraw when it turns. */
      clockMinute: number
      /** The highest context-fill threshold already warned about; 0 when none. */
      contextAlertLevel: number
      tab: PanelTab
      contextView: Shaped<ContextView | null>
      isContextLoading: boolean
      isPlanUsageLoading: boolean
    }
  }
}
