import { expect, test } from 'claude-code/testing'
import { DETAIL_LEVELS, buildUsageLayout, colorForPercent, fitUsageLayout, formatModelName, formatTimeUntil, formatTokenCount, layoutToSegments, measureCells, segmentsToPlainText } from './format'
import type { UsageSnapshot } from '../types'

const buildUsageSegments = (snapshot: UsageSnapshot, now: number, detail = DETAIL_LEVELS[0]!) => layoutToSegments(buildUsageLayout(snapshot, now, detail))
const fitUsageSegments = (snapshot: UsageSnapshot, now: number, width: number) => layoutToSegments(fitUsageLayout(snapshot, now, width))

const NOW = Date.parse('2026-11-15T12:00:00Z')

test('model ids become short names', async () => {
  expect(formatModelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(formatModelName('claude-fable-5-2[1m]')).toBe('Fable 5.2')
  expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(formatModelName('my-gateway-model')).toBe('my-gateway-model')
})

test('token counts are compact', async () => {
  expect(formatTokenCount(950)).toBe('950')
  expect(formatTokenCount(84_321)).toBe('84k')
  expect(formatTokenCount(1_000_000)).toBe('1M')
})

test('reset countdowns', async () => {
  expect(formatTimeUntil('2026-11-15T12:45:00Z', NOW)).toBe('45m')
  expect(formatTimeUntil('2026-11-15T16:12:00Z', NOW)).toBe('4h12m')
  expect(formatTimeUntil('2026-11-17T15:00:00Z', NOW)).toBe('2d3h')
  expect(formatTimeUntil('2026-11-15T11:00:00Z', NOW)).toBe('')
  expect(formatTimeUntil(undefined, NOW)).toBe('')
})

test('meter colors', async () => {
  expect(colorForPercent(10)).toBe('success')
  expect(colorForPercent(50)).toBe('warning')
  expect(colorForPercent(85)).toBe('error')
})

const LIMITS = [
  { kind: 'five_hour', percentUsed: 5, resetsAt: '2026-11-15T15:50:00Z' },
  { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-11-17T15:00:00Z' },
  { kind: 'seven_day_fable', percentUsed: 12 },
]

test('real reading from this account, on Opus (no Fable window)', async () => {
  const segments = buildUsageSegments({
    model: 'claude-opus-5-5', startedAt: 0, contextTokens: 109_877, contextWindow: 1_000_000, contextPercent: 11, costUsd: 1.7012, limits: LIMITS,
  }, NOW)
  expect(segmentsToPlainText(segments)).toBe(
    '\u{F06A9} Opus 5.5  │  \u{F09D1} ▰▱▱▱▱ 11% 110k/1M  │  \u{F051F} 5h ▰▱▱▱▱ 5% ↻3h50m  │  \u{F0A33} wk ▰▰▰▱▱ 50% ↻2d3h  │  \u{F01C1}1.70',
  )
  expect(segments.find(segment => segment.text === '50%')?.color).toBe('warning')
})

test('on Fable the Fable weekly window is shown', async () => {
  const text = segmentsToPlainText(buildUsageSegments({ model: 'claude-fable-5-2', startedAt: 0, contextWindow: 1_000_000, limits: LIMITS }, NOW))
  expect(text).toContain('\u{F0AE2} Fable ▰▱▱▱▱ 12%')
  expect(text).toContain('Fable 5.2')
})

test('the corner shrinks step by step as the terminal narrows', async () => {
  const snapshot = {
    model: 'claude-opus-5-5', startedAt: 0, contextTokens: 109_877, contextWindow: 1_000_000, contextPercent: 11, costUsd: 1.7012, limits: LIMITS,
  }
  const widths = [200, 90, 70, 55, 45, 30, 10]
  const results = widths.map(width => segmentsToPlainText(fitUsageSegments(snapshot, NOW, width)))
  expect(results[0]).toContain('110k/1M')
  expect(results[0]).toContain('↻2d3h')
  // Every result that can fit does fit.
  for (const [index, width] of widths.entries()) {
    const cells = measureCells(fitUsageSegments(snapshot, NOW, width))
    const smallest = measureCells(buildUsageSegments(snapshot, NOW, DETAIL_LEVELS[DETAIL_LEVELS.length - 1]!))
    expect(cells <= width || cells === smallest, `width ${width}`).toBe(true)
  }
  // The smallest form still keeps every percentage.
  expect(results[results.length - 1]).toBe('\u{F06A9} Opus │ \u{F09D1} 11% │ \u{F051F} 5h 5% │ \u{F0A33} wk 50%')
})

test('each part opens its own view: model, context, and usage for limits and cost', async () => {
  const layout = buildUsageLayout({
    model: 'claude-opus-5-5', startedAt: 0, contextTokens: 1, contextWindow: 10, contextPercent: 10, costUsd: 1, limits: LIMITS,
  }, NOW)
  expect(layout.groups.map(group => `${group.key}:${group.action}`)).toEqual([
    'model:model', 'context:context', 'limit-0:usage', 'limit-1:usage', 'cost:usage',
  ])
})
