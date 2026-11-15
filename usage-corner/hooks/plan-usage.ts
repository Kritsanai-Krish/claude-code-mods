import type { ContributorBlock, PlanUsage, PlanWindow } from '../types'
import { parseResetText } from './reset-time'

/**
 * The rate-limit headers a mod can read cover 5h and weekly only, and only as
 * of this session's last reply. The claude.ai usage endpoint has every window
 * (a model's own weekly one too) as of now, whatever session spent it.
 * `claude -p /usage` prints that endpoint's answer without calling a model
 * (no tokens, about a second), so the mod runs it and reads the text.
 */
export const USAGE_COMMAND_ARGUMENTS: readonly string[] = [
  '-p', '/usage',
  '--output-format', 'json',
  // No session file for this side run, and no user/project settings: no
  // hooks or plugins load in the child, so it stays fast and side-effect free.
  '--no-session-persistence',
  '--setting-sources', '',
]

// `Current session: 22% used · resets Nov 15, 10:50pm (Asia/Bangkok)`
// `Current week (Fable): 49% used · resets Nov 17, 10pm (Asia/Bangkok)`
const WINDOW_LINE = /^Current (session|week)(?: \(([^)]+)\))?: (\d+(?:\.\d+)?)% used(?: · resets (.+))?$/
const TIME_ZONE_SUFFIX = /\s*\(([^)]*)\)\s*$/
// `Last 24h · 782 requests · 25 sessions`, `Last 7d · …`
const CONTRIBUTORS_HEADER = /^Last \d+\s*[a-z]+\b/i
const ALL_MODELS_NAME = 'all models'

export const FIVE_HOUR_KIND = 'five_hour'
export const WEEK_KIND = 'seven_day'
/** A model's own weekly window is `seven_day_<family>` (e.g. `seven_day_fable`). */
export const MODEL_WINDOW_KIND_PREFIX = 'seven_day_'

/** Names the window a `/usage` line is about, the way the rate-limit headers name theirs. */
function kindForWindow(scope: string, name: string | undefined): string {
  if (scope === 'session') {
    return FIVE_HOUR_KIND
  }
  if (name === undefined || name.toLowerCase() === ALL_MODELS_NAME) {
    return WEEK_KIND
  }
  return `${MODEL_WINDOW_KIND_PREFIX}${name.toLowerCase().replace(/\s+/g, '_')}`
}

/** Reads one `Current …: N% used · resets …` line, or undefined for any other line. */
function parseWindowLine(line: string, nowMilliseconds: number): PlanWindow | undefined {
  const match = WINDOW_LINE.exec(line)
  if (match === null) {
    return undefined
  }
  const [, scope = '', name, percentText, resetPart = ''] = match
  const timeZone = TIME_ZONE_SUFFIX.exec(resetPart)?.[1]
  const resetText = resetPart.replace(TIME_ZONE_SUFFIX, '')
  const window: PlanWindow = {
    kind: kindForWindow(scope, name),
    name: name ?? scope,
    percentUsed: Number(percentText),
    resetText,
  }
  const resetsAtMilliseconds = parseResetText(resetText, timeZone, nowMilliseconds)
  if (resetsAtMilliseconds !== undefined) {
    window.resetsAtMilliseconds = resetsAtMilliseconds
  }
  return window
}

/** Pulls every limit window out of `/usage` text. */
export function parseWindows(usageText: string, nowMilliseconds: number): PlanWindow[] {
  const windows: PlanWindow[] = []
  for (const line of usageText.split('\n')) {
    const window = parseWindowLine(line.trim(), nowMilliseconds)
    if (window !== undefined) {
      windows.push(window)
    }
  }
  return windows
}

/** Pulls the "Last 24h" / "Last 7d" blocks of `/usage`: a header line, then what used the limits. */
export function parseContributorBlocks(usageText: string): ContributorBlock[] {
  const blocks: ContributorBlock[] = []
  let openBlock: ContributorBlock | undefined
  for (const rawLine of usageText.split('\n')) {
    const line = rawLine.trim()
    if (line === '') {
      openBlock = undefined
      continue
    }
    if (CONTRIBUTORS_HEADER.test(line)) {
      openBlock = { title: line, lines: [] }
      blocks.push(openBlock)
      continue
    }
    openBlock?.lines.push(line)
  }
  return blocks
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
    windows: parseWindows(usageText, fetchedAt),
    contributorBlocks: parseContributorBlocks(usageText),
    fetchedAt,
  }
}

/** Checks that a value read back from the store is a reading this version wrote. */
export function isPlanUsage(value: unknown): value is PlanUsage {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<PlanUsage>
  return Array.isArray(candidate.windows) && Array.isArray(candidate.contributorBlocks) && typeof candidate.fetchedAt === 'number'
}
