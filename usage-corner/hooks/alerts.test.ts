import { expect, test } from 'claude-code/testing'
import { decideAlerts, formatAlert, newThresholdReached } from './alerts'

test('a threshold warns once, then the next one', async () => {
  expect(newThresholdReached(50, 0)).toBeUndefined()
  expect(newThresholdReached(82, 0)).toBe(80)
  expect(newThresholdReached(85, 80)).toBeUndefined()
  expect(newThresholdReached(96, 80)).toBe(95)
  expect(newThresholdReached(97, 0)).toBe(95)
  expect(newThresholdReached(99, 95)).toBeUndefined()
})

test('alert text', async () => {
  expect(formatAlert({ windowKey: 'k', title: '5-hour limit', percentUsed: 82.4, resetText: 'in 1h20m' }))
    .toBe('⚠ 5-hour limit at 82% · resets in 1h20m')
})

test('warns once per window and period, and forgets reset periods', async () => {
  const weekly = { windowKey: 'seven_day@A', title: 'Weekly limit', percentUsed: 81, resetText: '' }
  let state = decideAlerts({}, [weekly])
  expect(state.messages).toEqual(['⚠ Weekly limit at 81%'])

  state = decideAlerts(state.memory, [{ ...weekly, percentUsed: 85 }])
  expect(state.messages).toEqual([])

  state = decideAlerts(state.memory, [{ ...weekly, percentUsed: 96 }])
  expect(state.messages).toEqual(['⚠ Weekly limit at 96%'])

  // The window reset: a new key warns again, and the old key is dropped.
  state = decideAlerts(state.memory, [{ ...weekly, windowKey: 'seven_day@B', percentUsed: 82 }])
  expect(state.messages).toEqual(['⚠ Weekly limit at 82%'])
  expect(Object.keys(state.memory)).toEqual(['seven_day@B'])
})
