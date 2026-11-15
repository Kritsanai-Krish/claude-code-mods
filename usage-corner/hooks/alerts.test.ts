import { expect, test } from 'claude-code/testing'
import { decideAlerts, decideContextAlert } from './alerts'
import type { WatchedWindow } from './alerts'

const RESET = Date.parse('2026-11-15T15:50:00Z')
const NOW = Date.parse('2026-11-15T12:00:00Z')

function fiveHour(percentUsed: number, resetsAtMilliseconds: number | undefined = RESET): WatchedWindow {
  return { kind: 'five_hour', title: '5-hour limit', percentUsed, resetsAtMilliseconds, resetText: 'in 1h20m', hasReset: false }
}

test('warns once at 80% and once at 95%, not again in between', async () => {
  const first = decideAlerts({}, [fiveHour(82)], NOW)
  expect(first.messages).toEqual(['⚠ 5-hour limit at 82% · resets in 1h20m'])
  const second = decideAlerts(first.memory, [fiveHour(88)], NOW)
  expect(second.messages).toEqual([])
  const third = decideAlerts(second.memory, [fiveHour(96)], NOW)
  expect(third.messages).toEqual(['⚠ 5-hour limit at 96% · resets in 1h20m'])
  expect(decideAlerts(third.memory, [fiveHour(99)], NOW).messages).toEqual([])
})

test('a reset time that jitters by a few minutes is still the same period', async () => {
  const first = decideAlerts({}, [fiveHour(82)], NOW)
  expect(decideAlerts(first.memory, [fiveHour(83, RESET + 5 * 60_000)], NOW).messages).toEqual([])
})

test('a new period says the limit has reset, then warns afresh', async () => {
  const first = decideAlerts({}, [fiveHour(96)], NOW)
  const nextPeriod = decideAlerts(first.memory, [fiveHour(3, RESET + 5 * 60 * 60_000)], NOW)
  expect(nextPeriod.messages).toEqual(['✓ 5-hour limit has reset'])
  const again = decideAlerts(nextPeriod.memory, [fiveHour(81, RESET + 5 * 60 * 60_000)], NOW)
  expect(again.messages).toEqual(['⚠ 5-hour limit at 81% · resets in 1h20m'])
})

test('a window that was never warned about resets silently', async () => {
  const first = decideAlerts({}, [fiveHour(40)], NOW)
  expect(decideAlerts(first.memory, [fiveHour(2, RESET + 5 * 60 * 60_000)], NOW).messages).toEqual([])
})

test('a window missing from one reading keeps its memory, so it does not warn twice', async () => {
  const first = decideAlerts({}, [fiveHour(82)], NOW)
  const withoutIt = decideAlerts(first.memory, [], NOW)
  expect(decideAlerts(withoutIt.memory, [fiveHour(84)], NOW).messages).toEqual([])
})

test('memory of a period that ended long ago is dropped', async () => {
  const first = decideAlerts({}, [fiveHour(82)], NOW)
  const muchLater = RESET + 9 * 24 * 60 * 60_000
  expect(decideAlerts(first.memory, [], muchLater).memory).toEqual({})
})

test('context: warns once per threshold on the way up, and re-arms after it drops', async () => {
  expect(decideContextAlert(0, 79)).toEqual({ level: 0, message: undefined })
  expect(decideContextAlert(0, 81)).toEqual({ level: 80, message: '⚠ Context 81% full · /compact to shrink it, /clear to start fresh' })
  expect(decideContextAlert(80, 85)).toEqual({ level: 80, message: undefined })
  expect(decideContextAlert(80, 93).level).toBe(90)
  expect(decideContextAlert(90, 30)).toEqual({ level: 0, message: undefined })
  expect(decideContextAlert(90, undefined)).toEqual({ level: 0, message: undefined })
})
