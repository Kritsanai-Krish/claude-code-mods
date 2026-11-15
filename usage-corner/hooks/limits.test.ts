import { expect, test } from 'claude-code/testing'
import type { PlanUsage, UsageSnapshot } from '../types'
import { describePace, mergeLimits } from './limits'

const NOW = Date.parse('2026-11-15T12:00:00Z')
const FIVE_HOUR_RESET = '2026-11-15T15:50:00.000Z'
const WEEK_RESET = '2026-11-17T15:00:00.000Z'

function snapshotWith(overrides: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    model: 'claude-fable-5-2', startedAt: NOW, contextWindow: 1_000_000, isContextEstimated: false,
    limits: [
      { kind: 'five_hour', percentUsed: 20, resetsAt: FIVE_HOUR_RESET },
      { kind: 'seven_day', percentUsed: 50, resetsAt: WEEK_RESET },
    ],
    limitsReadAt: NOW - 60_000,
    ...overrides,
  }
}

function planWith(fetchedAt: number): PlanUsage {
  return {
    windows: [
      { kind: 'five_hour', name: 'session', percentUsed: 31, resetText: 'Nov 15, 10:50pm', resetsAtMilliseconds: Date.parse(FIVE_HOUR_RESET) },
      { kind: 'seven_day_fable', name: 'Fable', percentUsed: 49, resetText: 'Nov 17, 10pm', resetsAtMilliseconds: Date.parse(WEEK_RESET) },
    ],
    contributorBlocks: [],
    fetchedAt,
  }
}

test('without /usage the header readings are shown as they are', async () => {
  const limits = mergeLimits(snapshotWith({}), null, NOW)
  expect(limits.map(limit => [limit.kind, limit.percentUsed, limit.resetsAtMilliseconds])).toEqual([
    ['five_hour', 20, Date.parse(FIVE_HOUR_RESET)],
    ['seven_day', 50, Date.parse(WEEK_RESET)],
  ])
})

test('a newer /usage reading wins, and adds the windows the headers lack', async () => {
  const limits = mergeLimits(snapshotWith({}), planWith(NOW - 1_000), NOW)
  expect(limits.map(limit => [limit.kind, limit.percentUsed])).toEqual([
    ['five_hour', 31], ['seven_day', 50], ['seven_day_fable', 49],
  ])
  expect(limits[2]?.title).toBe('Fable weekly limit')
})

test('an older /usage reading does not overwrite what a newer reply reported', async () => {
  const limits = mergeLimits(snapshotWith({}), planWith(NOW - 120_000), NOW)
  expect(limits.find(limit => limit.kind === 'five_hour')?.percentUsed).toBe(20)
})

test('a window whose reset time has passed reads 0% and is marked as reset', async () => {
  const later = Date.parse('2026-11-15T16:00:00Z')
  const limits = mergeLimits(snapshotWith({}), null, later)
  const fiveHour = limits.find(limit => limit.kind === 'five_hour')
  expect(fiveHour?.percentUsed).toBe(0)
  expect(fiveHour?.hasReset).toBe(true)
  expect(fiveHour?.resetsAtMilliseconds).toBe(undefined)
  expect(limits.find(limit => limit.kind === 'seven_day')?.hasReset).toBe(false)
})

test('before the first reply, /usage alone fills the corner', async () => {
  const limits = mergeLimits(snapshotWith({ limits: [], limitsReadAt: 0 }), planWith(NOW), NOW)
  expect(limits.map(limit => limit.kind)).toEqual(['five_hour', 'seven_day_fable'])
})

test('pace: burning faster than the window refills says when it runs out', async () => {
  // 5h window, 1h10m in, 60% used: empty after another ~47m, long before the reset.
  const pace = describePace({ kind: 'five_hour', percentUsed: 60, resetsAtMilliseconds: NOW + (3 * 60 + 50) * 60_000 }, NOW)
  expect(pace).toEqual({ isRunningOut: true, text: 'at this pace: used up in 47m, before the reset' })
})

test('pace: a slow burn says where it lands at the reset', async () => {
  const pace = describePace({ kind: 'five_hour', percentUsed: 20, resetsAtMilliseconds: NOW + 150 * 60_000 }, NOW)
  expect(pace).toEqual({ isRunningOut: false, text: 'at this pace: about 40% by the reset' })
})

test('pace: says nothing when it is too early to tell or the window is unknown', async () => {
  expect(describePace({ kind: 'five_hour', percentUsed: 1, resetsAtMilliseconds: NOW + 299 * 60_000 }, NOW)).toBe(undefined)
  expect(describePace({ kind: 'five_hour', percentUsed: 50 }, NOW)).toBe(undefined)
  expect(describePace({ kind: 'spend_limit', percentUsed: 50, resetsAtMilliseconds: NOW + 60_000 }, NOW)).toBe(undefined)
  expect(describePace({ kind: 'five_hour', percentUsed: 100, resetsAtMilliseconds: NOW + 60_000 }, NOW)).toBe(undefined)
})
