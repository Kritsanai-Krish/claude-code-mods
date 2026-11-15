import { expect, test } from 'claude-code/testing'
import type { UsageSnapshot } from '../types'
import { buildSnapshot, isSameSnapshot } from './snapshot'
import type { EngineReading } from './snapshot'

const NOW = Date.parse('2026-11-15T12:00:00Z')

const READING: EngineReading = {
  model: 'claude-opus-5-5',
  startedAt: NOW - 60_000,
  context: { tokens: 100_000, window: 1_000_000, percent: 10 },
  costUsd: 1.5,
  limits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: '2026-11-15T15:50:00.000Z' }],
  settingsEffort: undefined,
  estimatedContextTokens: undefined,
}

const first = (): UsageSnapshot => buildSnapshot(null, READING, {}, NOW)

test('the first reading becomes the snapshot as it is', async () => {
  expect(first()).toEqual({
    model: 'claude-opus-5-5', startedAt: NOW - 60_000, contextTokens: 100_000, contextWindow: 1_000_000, contextPercent: 10,
    isContextEstimated: false, costUsd: 1.5, limits: READING.limits, limitsReadAt: NOW,
  })
})

test('with no API count yet, the local estimate fills the context and is marked', async () => {
  const snapshot = buildSnapshot(null, { ...READING, context: { window: 1_000_000 }, estimatedContextTokens: 57_527 }, {}, NOW)
  expect([snapshot.contextTokens, snapshot.contextPercent, snapshot.isContextEstimated]).toEqual([57_527, 6, true])
})

test('with neither a count nor an estimate the context is left out', async () => {
  const snapshot = buildSnapshot(null, { ...READING, context: { window: 200_000 } }, {}, NOW)
  expect([snapshot.contextTokens, snapshot.contextPercent, snapshot.contextWindow]).toEqual([undefined, undefined, 200_000])
})

test('a model request sets the effort it was sent with and the model that answered', async () => {
  const snapshot = buildSnapshot(first(), READING, { requestEffort: { level: 'high' }, answeringModel: 'claude-opus-5-5' }, NOW + 5_000)
  expect([snapshot.effort, snapshot.answeringModel]).toEqual(['high', 'claude-opus-5-5'])
})

test('a request on a model that takes no effort clears it', async () => {
  const withEffort = buildSnapshot(first(), READING, { requestEffort: { level: 'high' } }, NOW)
  expect(buildSnapshot(withEffort, READING, { requestEffort: {} }, NOW).effort).toBe(undefined)
})

test('/effort changes the settings, and the corner follows before the next request', async () => {
  const afterStep = buildSnapshot(first(), READING, { requestEffort: { level: 'high' } }, NOW)
  const afterCommand = buildSnapshot(afterStep, { ...READING, settingsEffort: 'low' }, {}, NOW)
  expect(afterCommand.effort).toBe('low')
})

test('an unchanged settings value never overrides what the last request really used', async () => {
  const withSetting = buildSnapshot(null, { ...READING, settingsEffort: 'medium' }, {}, NOW)
  // A session-only effort: the request went out at `max`, the settings file still says medium.
  const afterStep = buildSnapshot(withSetting, { ...READING, settingsEffort: 'medium' }, { requestEffort: { level: 'max' } }, NOW)
  const afterTick = buildSnapshot(afterStep, { ...READING, settingsEffort: 'medium' }, {}, NOW)
  expect(afterTick.effort).toBe('max')
})

test('switching model drops the old model\'s effort and fallback note', async () => {
  const onOpus = buildSnapshot(first(), READING, { requestEffort: { level: 'high' }, answeringModel: 'claude-sonnet-5-5' }, NOW)
  const onHaiku = buildSnapshot(onOpus, { ...READING, model: 'claude-haiku-5-5' }, {}, NOW)
  expect([onHaiku.model, onHaiku.effort, onHaiku.answeringModel]).toEqual(['claude-haiku-5-5', undefined, undefined])
})

test('the limits keep the time a reply last confirmed them', async () => {
  const later = buildSnapshot(first(), READING, {}, NOW + 60_000)
  expect(later.limitsReadAt).toBe(NOW)
  const afterReply = buildSnapshot(later, READING, { isFromResponse: true }, NOW + 120_000)
  expect(afterReply.limitsReadAt).toBe(NOW + 120_000)
  const changed = buildSnapshot(afterReply, { ...READING, limits: [{ kind: 'five_hour', percentUsed: 21 }] }, {}, NOW + 180_000)
  expect(changed.limitsReadAt).toBe(NOW + 180_000)
})

test('two readings with the same figures compare equal, so nothing is redrawn', async () => {
  expect(isSameSnapshot(first(), buildSnapshot(first(), READING, {}, NOW + 5_000))).toBe(true)
  expect(isSameSnapshot(first(), buildSnapshot(first(), { ...READING, costUsd: 1.6 }, {}, NOW))).toBe(false)
  expect(isSameSnapshot(null, first())).toBe(false)
})
