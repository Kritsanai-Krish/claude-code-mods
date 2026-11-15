import { expect, test } from 'claude-code/testing'
import { parseResetText } from './reset-time'

const NOW = Date.parse('2026-11-15T12:00:00Z')

test('a date and time in a named zone becomes clock milliseconds', async () => {
  expect(parseResetText('Nov 17, 10pm', 'Asia/Bangkok', NOW)).toBe(Date.parse('2026-11-17T15:00:00Z'))
  expect(parseResetText('Nov 15, 10:50pm', 'Asia/Bangkok', NOW)).toBe(Date.parse('2026-11-15T15:50:00Z'))
  expect(parseResetText('Nov 17, 9:59pm', 'UTC', NOW)).toBe(Date.parse('2026-11-17T21:59:00Z'))
})

test('noon and midnight are read the 12-hour way', async () => {
  expect(parseResetText('Nov 16, 12am', 'UTC', NOW)).toBe(Date.parse('2026-11-16T00:00:00Z'))
  expect(parseResetText('Nov 16, 12pm', 'UTC', NOW)).toBe(Date.parse('2026-11-16T12:00:00Z'))
})

test('a zone with daylight saving uses the offset in force on that day', async () => {
  const beforeSwitch = Date.parse('2026-03-01T12:00:00Z')
  expect(parseResetText('Mar 7, 10pm', 'America/New_York', beforeSwitch)).toBe(Date.parse('2026-03-08T03:00:00Z'))
  expect(parseResetText('Mar 8, 10pm', 'America/New_York', beforeSwitch)).toBe(Date.parse('2026-03-09T02:00:00Z'))
})

test('a January reset read in December belongs to next year', async () => {
  const lateDecember = Date.parse('2026-12-30T12:00:00Z')
  expect(parseResetText('Jan 2, 9am', 'UTC', lateDecember)).toBe(Date.parse('2027-01-02T09:00:00Z'))
})

test('a time alone means its next occurrence', async () => {
  expect(parseResetText('10:50pm', 'Asia/Bangkok', NOW)).toBe(Date.parse('2026-11-15T15:50:00Z'))
  expect(parseResetText('6pm', 'Asia/Bangkok', NOW)).toBe(Date.parse('2026-11-16T11:00:00Z'))
})

test('text that is not a reset time, or an unknown zone, gives undefined', async () => {
  expect(parseResetText('soon', 'UTC', NOW)).toBe(undefined)
  expect(parseResetText('Nov 17, 25pm', 'UTC', NOW)).toBe(undefined)
  expect(parseResetText('Foo 17, 10pm', 'UTC', NOW)).toBe(undefined)
  expect(parseResetText('Nov 17, 10pm', 'Not/AZone', NOW)).toBe(undefined)
  expect(parseResetText('', undefined, NOW)).toBe(undefined)
})
