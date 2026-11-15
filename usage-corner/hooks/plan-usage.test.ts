import { expect, test } from 'claude-code/testing'
import { parsePlanUsage, readResultText } from './plan-usage'

const NOW = Date.parse('2026-11-15T12:00:00Z')

const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 22% used · resets Nov 15, 10:50pm (Asia/Bangkok)
Current week (all models): 52% used · resets Nov 17, 10pm (Asia/Bangkok)
Current week (Fable): 49.5% used · resets Nov 17, 10pm (Asia/Bangkok)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 782 requests · 25 sessions
  68%  Start fresh when you switch tasks · run /clear
  30%  Turn off MCP servers you don't use · 18k tokens per request

Last 7d · 912 requests · 35 sessions
  65%  Start fresh when you switch tasks · run /clear
`

test('every window of /usage is read, with its kind and reset time', async () => {
  const usage = parsePlanUsage(USAGE_TEXT, NOW)
  expect(usage.windows).toEqual([
    { kind: 'five_hour', name: 'session', percentUsed: 22, resetText: 'Nov 15, 10:50pm', resetsAtMilliseconds: Date.parse('2026-11-15T15:50:00Z') },
    { kind: 'seven_day', name: 'all models', percentUsed: 52, resetText: 'Nov 17, 10pm', resetsAtMilliseconds: Date.parse('2026-11-17T15:00:00Z') },
    { kind: 'seven_day_fable', name: 'Fable', percentUsed: 49.5, resetText: 'Nov 17, 10pm', resetsAtMilliseconds: Date.parse('2026-11-17T15:00:00Z') },
  ])
  expect(usage.fetchedAt).toBe(NOW)
})

test('both "what used your limits" blocks are kept, each under its header', async () => {
  const usage = parsePlanUsage(USAGE_TEXT, NOW)
  expect(usage.contributorBlocks).toEqual([
    { title: 'Last 24h · 782 requests · 25 sessions', lines: ['68%  Start fresh when you switch tasks · run /clear', "30%  Turn off MCP servers you don't use · 18k tokens per request"] },
    { title: 'Last 7d · 912 requests · 35 sessions', lines: ['65%  Start fresh when you switch tasks · run /clear'] },
  ])
})

test('a window without a reset, and text with no windows, are both fine', async () => {
  const usage = parsePlanUsage('Current week (Opus): 3% used\n', NOW)
  expect(usage.windows).toEqual([{ kind: 'seven_day_opus', name: 'Opus', percentUsed: 3, resetText: '' }])
  expect(parsePlanUsage('You are using an API key.', NOW)).toEqual({ windows: [], contributorBlocks: [], fetchedAt: NOW })
})

test('reads the result out of the JSON envelope, and rejects junk', async () => {
  expect(readResultText('{"result":"hello"}')).toBe('hello')
  expect(() => readResultText('{"other":1}')).toThrow()
  expect(() => readResultText('{"result":5}')).toThrow()
  expect(() => readResultText('not json')).toThrow()
})
