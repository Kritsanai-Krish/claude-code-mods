import type { ModelWindow, PlanUsage } from '../types'

/**
 * Per-model weekly windows (Fable's) are not in the rate-limit headers a mod
 * can read; only the claude.ai usage endpoint has them. `claude -p /usage`
 * prints that endpoint's answer without calling a model (no tokens, ~1.5 s),
 * so the mod runs it and reads the text.
 */
export const USAGE_COMMAND_ARGUMENTS: readonly string[] = [
  '-p', '/usage',
  '--output-format', 'json',
  // No session file for this side run, and no user/project settings: no
  // hooks or plugins load in the child, so it stays fast and side-effect free.
  '--no-session-persistence',
  '--setting-sources', '',
]

const MODEL_WINDOW_LINE = /^Current week \(([^)]+)\): (\d+(?:\.\d+)?)% used(?: · resets (.+))?$/
const ALL_MODELS_NAME = 'all models'
const CONTRIBUTORS_HEADER = /^Last 24h\b/
const TIME_ZONE_SUFFIX = /\s*\([^)]*\)\s*$/

/** Pulls the per-model weekly windows out of `/usage` text: `Current week (Fable): 49% used · resets …`. */
export function parseModelWindows(usageText: string): ModelWindow[] {
  const windows: ModelWindow[] = []
  for (const line of usageText.split('\n')) {
    const match = MODEL_WINDOW_LINE.exec(line.trim())
    if (match === null) {
      continue
    }
    const name = match[1] ?? ''
    if (name.toLowerCase() === ALL_MODELS_NAME) {
      continue
    }
    windows.push({
      name,
      percentUsed: Number(match[2]),
      resetText: (match[3] ?? '').replace(TIME_ZONE_SUFFIX, ''),
    })
  }
  return windows
}

/** Pulls the "Last 24h" block of `/usage` (what used the limits, with tips), one entry per line. */
export function parseContributors(usageText: string): string[] {
  const lines = usageText.split('\n')
  const headerIndex = lines.findIndex(line => CONTRIBUTORS_HEADER.test(line.trim()))
  if (headerIndex === -1) {
    return []
  }
  const block: string[] = []
  for (const line of lines.slice(headerIndex)) {
    if (line.trim() === '') {
      break
    }
    block.push(line.trim())
  }
  return block
}

/** Reads the `result` text out of `claude -p --output-format json` output. */
export function readResultText(stdout: string): string {
  const parsed: unknown = JSON.parse(stdout)
  if (typeof parsed !== 'object' || parsed === null || !('result' in parsed)) {
    throw new Error(`claude -p /usage printed no result: ${stdout.slice(0, 200)}`)
  }
  const result = (parsed as { result: unknown }).result
  if (typeof result !== 'string') {
    throw new Error('claude -p /usage result is not text')
  }
  return result
}

/** Builds the stored reading from `/usage` text. */
export function parsePlanUsage(usageText: string, fetchedAt: number): PlanUsage {
  return {
    modelWindows: parseModelWindows(usageText),
    contributors: parseContributors(usageText),
    fetchedAt,
  }
}

/** Returns the window that belongs to the model in use (`Fable` while on claude-fable-…), if any. */
export function windowForModel(windows: readonly ModelWindow[], modelId: string): ModelWindow | undefined {
  const lowerModelId = modelId.toLowerCase()
  return windows.find(window => lowerModelId.includes(`claude-${window.name.toLowerCase()}`))
}
