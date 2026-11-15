import type { SessionActivity, TokenTotals, TurnSummary } from '../types'

/** The API's own names for a response's token counts (the engine's ModelUsage). */
export type ApiUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model?: string
}

const NO_TOKENS: TokenTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

/** A session that has not asked the model anything yet. */
export const EMPTY_ACTIVITY: SessionActivity = { turnCount: 0, subagentRunCount: 0, totals: NO_TOKENS }

function toTokenTotals(usage: ApiUsage): TokenTotals {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
  }
}

function addTotals(first: TokenTotals, second: TokenTotals): TokenTotals {
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    cacheReadTokens: first.cacheReadTokens + second.cacheReadTokens,
    cacheWriteTokens: first.cacheWriteTokens + second.cacheWriteTokens,
  }
}

/**
 * Counts a finished turn. Every loop's tokens add to the session totals; only
 * a main-loop turn (the person's own prompt) counts as a turn and is
 * remembered as the last one, a subagent's run counts as a subagent run.
 */
export function addTurn(
  activity: SessionActivity,
  turn: { durationMs: number; reason: string; usage?: ApiUsage },
  isMainLoop: boolean,
): SessionActivity {
  const turnTokens = turn.usage === undefined ? NO_TOKENS : toTokenTotals(turn.usage)
  const totals = addTotals(activity.totals, turnTokens)
  if (!isMainLoop) {
    return { ...activity, subagentRunCount: activity.subagentRunCount + 1, totals }
  }
  const lastTurn: TurnSummary = { ...turnTokens, durationMilliseconds: turn.durationMs, endReason: turn.reason }
  if (turn.usage?.model !== undefined) {
    lastTurn.model = turn.usage.model
  }
  return { ...activity, turnCount: activity.turnCount + 1, totals, lastTurn }
}

/** The share of everything sent to the model that was read from the prompt cache, 0 to 100. */
export function cacheHitPercent(totals: TokenTotals): number | undefined {
  const sentTokens = totals.inputTokens + totals.cacheReadTokens + totals.cacheWriteTokens
  if (sentTokens === 0) {
    return undefined
  }
  return Math.round((totals.cacheReadTokens / sentTokens) * 100)
}
