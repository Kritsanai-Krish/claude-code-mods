/** One rate-limit window as shown in the corner. */
export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

/** Everything the corner and the Usage tab are built from. */
export type UsageSnapshot = {
  model: string
  startedAt: number
  contextTokens?: number
  contextWindow: number
  contextPercent?: number
  costUsd?: number
  limits: LimitReading[]
}

/** A model's own weekly window, e.g. Fable's, as `/usage` prints it. */
export type ModelWindow = { name: string; percentUsed: number; resetText: string }

/** What `claude -p /usage` adds to the headers: per-model windows and what used the limits. */
export type PlanUsage = {
  modelWindows: ModelWindow[]
  /** The "Last 24h" block: a header line, then one line per cause or tip. */
  contributors: string[]
  fetchedAt: number
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

/** The context window broken down by category, as the Context tab draws it. */
export type ContextView = {
  model: string
  categories: ContextCategoryRow[]
  gridRows: ContextSquare[][]
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactThreshold?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-corner': {
      snapshot: Shaped<UsageSnapshot | null>
      tab: PanelTab
      contextView: Shaped<ContextView | null>
      isContextLoading: boolean
      planUsage: Shaped<PlanUsage | null>
      isPlanUsageLoading: boolean
    }
  }
}
