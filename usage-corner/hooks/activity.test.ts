import { expect, test } from 'claude-code/testing'
import { EMPTY_ACTIVITY, addTurn, cacheHitPercent } from './activity'

const USAGE = { input_tokens: 2, output_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 98, model: 'claude-opus-5-5' }
const TURN = { durationMs: 7230, reason: 'answer', usage: USAGE }

test('a main-loop turn is counted, adds its tokens and is remembered as the last turn', async () => {
  const activity = addTurn(EMPTY_ACTIVITY, TURN, true)
  expect([activity.turnCount, activity.subagentRunCount]).toEqual([1, 0])
  expect(activity.totals).toEqual({ inputTokens: 2, outputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 98 })
  expect(activity.lastTurn).toEqual({
    durationMilliseconds: 7230, endReason: 'answer', model: 'claude-opus-5-5',
    inputTokens: 2, outputTokens: 100, cacheReadTokens: 900, cacheWriteTokens: 98,
  })
})

test('a subagent run adds its tokens but is not a turn of the person\'s', async () => {
  const afterMain = addTurn(EMPTY_ACTIVITY, TURN, true)
  const activity = addTurn(afterMain, { ...TURN, durationMs: 99 }, false)
  expect([activity.turnCount, activity.subagentRunCount]).toEqual([1, 1])
  expect(activity.totals.outputTokens).toBe(200)
  expect(activity.lastTurn?.durationMilliseconds).toBe(7230)
})

test('a turn that reported no usage (interrupted, API error) still counts', async () => {
  const activity = addTurn(EMPTY_ACTIVITY, { durationMs: 10, reason: 'aborted' }, true)
  expect(activity.turnCount).toBe(1)
  expect(activity.totals).toEqual(EMPTY_ACTIVITY.totals)
  expect(activity.lastTurn?.endReason).toBe('aborted')
})

test('cache hit rate is cache reads over everything sent', async () => {
  expect(cacheHitPercent({ inputTokens: 2, outputTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 98 })).toBe(90)
  expect(cacheHitPercent(EMPTY_ACTIVITY.totals)).toBe(undefined)
})
