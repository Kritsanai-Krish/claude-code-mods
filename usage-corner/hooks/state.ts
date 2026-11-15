import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { ContextView, PanelTab, PlanUsage, UsageSnapshot } from '../types'
import { USAGE_COMMAND_ARGUMENTS, parsePlanUsage, readResultText } from './plan-usage'

// Every read and update of these stays in this file: the engine lists a mod's
// state by scanning for atoms declared in the file that uses them.
// Change a shape tag when that value's fields change: a reload then ignores
// what the older code stored instead of reading it with missing fields.
const snapshotAtom = atom({ plugin: 'usage-corner', key: 'snapshot' } as const, null, { shape: 'snapshot-2' })
const tabAtom = atom({ plugin: 'usage-corner', key: 'tab' } as const, 'usage')
const contextViewAtom = atom({ plugin: 'usage-corner', key: 'contextView' } as const, null, { shape: 'context-view-1' })
const isContextLoadingAtom = atom({ plugin: 'usage-corner', key: 'isContextLoading' } as const, false)
const planUsageAtom = atom({ plugin: 'usage-corner', key: 'planUsage' } as const, null, { shape: 'plan-usage-1' })
const isPlanUsageLoadingAtom = atom({ plugin: 'usage-corner', key: 'isPlanUsageLoading' } as const, false)

// `/usage` asks the claude.ai endpoint; once a minute is plenty for limits
// that move by whole percents, and keeps a burst of turns from spawning many runs.
const PLAN_USAGE_MIN_INTERVAL_MILLISECONDS = 60_000
const PLAN_USAGE_TIMEOUT_MILLISECONDS = 30_000

/** Reads the model, context window, rate limits and cost, and stores them for the corner and the panel. */
export async function refreshSnapshot($: EngineInterface): Promise<void> {
  const [usage, model] = await Promise.all([$.session.usage(), $.session.model()])
  const snapshot: UsageSnapshot = {
    model,
    startedAt: usage.startedAt,
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    contextPercent: usage.context.percent,
    costUsd: usage.cost?.usd,
    limits: usage.rateLimits.map(limit => ({
      kind: limit.kind,
      percentUsed: limit.percentUsed,
      resetsAt: limit.resetsAt,
    })),
  }
  await update($, snapshotAtom, () => snapshot)
}

/**
 * Refreshes without ever failing the event it rides on: a missing reading
 * should leave the old figures, not break a session start or a turn.
 */
export async function refreshSnapshotSafely($: EngineInterface): Promise<void> {
  try {
    await refreshSnapshot($)
  } catch (error) {
    $.ui.log(`usage-corner: could not read session usage: ${String(error)}`)
  }
}

/**
 * Counts the context window by category for the Context tab. Uses the same
 * exact count as /context (`full`); if that fails, falls back to the local
 * estimate so the tab still shows something.
 */
export async function refreshContextView($: EngineInterface): Promise<void> {
  await update($, isContextLoadingAtom, () => true)
  try {
    const usage = await readBreakdown($)
    const breakdown = usage.context.breakdown
    if (breakdown === undefined) {
      return
    }
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
      totalTokens: breakdown.totalTokens,
      maxTokens: breakdown.maxTokens,
      percentage: breakdown.percentage,
      autoCompactThreshold: breakdown.autoCompactThreshold,
    }
    await update($, contextViewAtom, () => view)
  } catch (error) {
    $.ui.toast(`usage-corner: could not count the context: ${String(error)}`)
  } finally {
    await update($, isContextLoadingAtom, () => false)
  }
}

async function readBreakdown($: EngineInterface) {
  try {
    return await $.session.usage({ breakdown: 'full' })
  } catch {
    return await $.session.usage({ breakdown: 'summary' })
  }
}

/** The corner's latest figures, or null before the first reading. */
export async function readSnapshot($: EngineInterface): Promise<UsageSnapshot | null> {
  return read($, snapshotAtom)
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
    contextView: await read($, contextViewAtom),
    isContextLoading: await read($, isContextLoadingAtom),
    planUsage: await read($, planUsageAtom),
    isPlanUsageLoading: await read($, isPlanUsageLoadingAtom),
  }
}

/** The latest `/usage` reading (per-model windows), or null before one. */
export async function readPlanUsage($: EngineInterface): Promise<PlanUsage | null> {
  return read($, planUsageAtom)
}

/**
 * Runs `claude -p /usage` for the per-model weekly windows (Fable's) and the
 * "what used your limits" summary. Skipped when a reading is under a minute
 * old unless `isForced`; a failure keeps the old reading and is logged.
 */
export async function refreshPlanUsage($: EngineInterface, isForced: boolean): Promise<void> {
  const now = await $.clock.now()
  const previous = await read($, planUsageAtom)
  const isFresh = previous !== null && now - previous.fetchedAt < PLAN_USAGE_MIN_INTERVAL_MILLISECONDS
  if ((isFresh && !isForced) || (await read($, isPlanUsageLoadingAtom))) {
    return
  }
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
    const reading = parsePlanUsage(readResultText(result.stdout), now)
    await update($, planUsageAtom, () => reading)
  } catch (error) {
    $.ui.log(`usage-corner: could not read /usage: ${String(error)}`)
  } finally {
    await update($, isPlanUsageLoadingAtom, () => false)
  }
}
