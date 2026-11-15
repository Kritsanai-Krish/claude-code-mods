import { expect, test } from 'claude-code/testing'
import type { UsageSnapshot } from '../types'
import {
  DETAIL_LEVELS, buildUsageLayout, colorForPercent, fitUsageLayout, formatCost, formatModelName, formatTokenCount,
  layoutToSegments, measureCells, segmentsToPlainText,
} from './format'
import type { CornerData } from './format'
import type { LimitView } from './limits'

const NOW = Date.parse('2026-11-15T12:00:00Z')

const LIMITS: LimitView[] = [
  { kind: 'five_hour', title: '5-hour limit', percentUsed: 5, resetsAtMilliseconds: Date.parse('2026-11-15T15:50:00Z'), resetText: '', hasReset: false },
  { kind: 'seven_day', title: 'Weekly limit', percentUsed: 50, resetsAtMilliseconds: Date.parse('2026-11-17T15:00:00Z'), resetText: '', hasReset: false },
  { kind: 'seven_day_fable', title: 'Fable weekly limit', percentUsed: 12, resetText: 'Nov 17, 10pm', hasReset: false },
]

const OPUS_SNAPSHOT: UsageSnapshot = {
  model: 'claude-opus-5-5', startedAt: 0, contextTokens: 109_877, contextWindow: 1_000_000, contextPercent: 11,
  isContextEstimated: false, costUsd: 1.7012, limits: [], limitsReadAt: NOW,
}

function cornerData(snapshot: Partial<UsageSnapshot> = {}, overrides: Partial<CornerData> = {}): CornerData {
  return {
    snapshot: { ...OPUS_SNAPSHOT, ...snapshot }, limits: LIMITS, nowMilliseconds: NOW,
    iconStyle: 'nerd', isCostShown: true, ...overrides,
  }
}

const textOf = (data: CornerData, detail = DETAIL_LEVELS[0]!) => segmentsToPlainText(layoutToSegments(buildUsageLayout(data, detail)))
const fitted = (data: CornerData, width: number) => layoutToSegments(fitUsageLayout(data, width))

test('model ids become short names', async () => {
  expect(formatModelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(formatModelName('claude-fable-5-2[1m]')).toBe('Fable 5.2')
  expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(formatModelName('us.anthropic.claude-opus-5-5-v1:0')).toBe('Opus 5.5')
  expect(formatModelName('my-gateway-model')).toBe('my-gateway-model')
})

test('token counts are compact', async () => {
  expect(formatTokenCount(950)).toBe('950')
  expect(formatTokenCount(84_321)).toBe('84k')
  expect(formatTokenCount(999_600)).toBe('1M')
  expect(formatTokenCount(1_000_000)).toBe('1M')
  expect(formatTokenCount(1_250_000)).toBe('1.3M')
})

test('cost keeps cents until it is large', async () => {
  expect(formatCost(0)).toBe('0.00')
  expect(formatCost(1.7012)).toBe('1.70')
  expect(formatCost(123.456)).toBe('123')
})

test('meter colors', async () => {
  expect(colorForPercent(10)).toBe('success')
  expect(colorForPercent(50)).toBe('warning')
  expect(colorForPercent(85)).toBe('error')
})

test('the full corner on Opus: no Fable window, countdowns from the reset moments', async () => {
  const segments = layoutToSegments(buildUsageLayout(cornerData()))
  expect(segmentsToPlainText(segments)).toBe(
    '\u{F06A9} Opus 5.5  │  \u{F09D1} ▰▱▱▱▱ 11% 110k/1M  │  \u{F051F} 5h ▰▱▱▱▱ 5% ↻3h50m  │  \u{F0A33} wk ▰▰▰▱▱ 50% ↻2d3h  │  \u{F01C1}1.70',
  )
  expect(segments.find(segment => segment.text === '50%')?.color).toBe('warning')
})

test('on Fable the Fable weekly window is shown', async () => {
  const text = textOf(cornerData({ model: 'claude-fable-5-2' }))
  expect(text).toContain('\u{F0AE2} Fable ▰▱▱▱▱ 12%')
  expect(text).toContain('Fable 5.2')
})

test('the effort level follows the model name', async () => {
  expect(textOf(cornerData({ effort: 'high' }))).toContain('\u{F06A9} Opus 5.5 · high  │')
})

test('a fallback model that answered instead is pointed out', async () => {
  expect(textOf(cornerData({ model: 'claude-fable-5-2', answeringModel: 'claude-opus-5-5' }))).toContain('Fable 5.2 → Opus 5.5')
  expect(textOf(cornerData({ answeringModel: 'claude-opus-5-5-20261101' }))).not.toContain('→')
})

test('an estimated context is marked with ~', async () => {
  const text = textOf(cornerData({ contextTokens: 57_527, contextPercent: 6, isContextEstimated: true }))
  expect(text).toContain('~6% ~58k/1M')
})

test('before any count the context shows the window size alone', async () => {
  const text = textOf(cornerData({ contextTokens: undefined, contextPercent: undefined }))
  expect(text).toContain('\u{F09D1} 1M  │')
})

test('a window that has reset says so instead of counting down', async () => {
  const resetLimits: LimitView[] = [{ kind: 'five_hour', title: '5-hour limit', percentUsed: 0, resetText: '', hasReset: true }]
  expect(textOf(cornerData({}, { limits: resetLimits }))).toContain('5h ▱▱▱▱▱ 0% reset')
})

test('plain symbols replace the Nerd Font icons when asked', async () => {
  expect(textOf(cornerData({}, { iconStyle: 'unicode' }))).toBe(
    '◆ Opus 5.5  │  ◔ ▰▱▱▱▱ 11% 110k/1M  │  ◷ 5h ▰▱▱▱▱ 5% ↻3h50m  │  ▤ wk ▰▰▰▱▱ 50% ↻2d3h  │  $1.70',
  )
})

test('the cost can be turned off', async () => {
  expect(textOf(cornerData({}, { isCostShown: false }))).not.toContain('1.70')
})

test('the corner shrinks step by step as the terminal narrows', async () => {
  const data = cornerData({ effort: 'high' })
  const widths = [200, 90, 70, 55, 45, 30, 10]
  const results = widths.map(width => segmentsToPlainText(fitted(data, width)))
  expect(results[0]).toContain('110k/1M')
  expect(results[0]).toContain('↻2d3h')
  expect(results[0]).toContain('· high')
  const smallest = measureCells(layoutToSegments(buildUsageLayout(data, DETAIL_LEVELS.at(-1)!)))
  for (const [index, width] of widths.entries()) {
    const cells = measureCells(fitted(data, width))
    expect(cells <= width || cells === smallest, `width ${width}: ${results[index]}`).toBe(true)
  }
  // The smallest form still keeps every percentage.
  expect(results.at(-1)).toBe('\u{F06A9} Opus │ \u{F09D1} 11% │ \u{F051F} 5h 5% │ \u{F0A33} wk 50%')
})

test('each part opens its own view: model, context, and usage for limits and cost', async () => {
  const layout = buildUsageLayout(cornerData())
  expect(layout.groups.map(group => `${group.key}:${group.action}`)).toEqual([
    'model:model', 'context:context', 'limit-five_hour:usage', 'limit-seven_day:usage', 'cost:usage',
  ])
})
