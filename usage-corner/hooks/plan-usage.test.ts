import { expect, test } from 'claude-code/testing'
import { parsePlanUsage, readResultText, windowForModel } from './plan-usage'

// Sample `claude -p /usage` output (Claude Code 2.1.325).
const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 7% used · resets Nov 15, 10:49pm (UTC)
Current week (all models): 50% used · resets Nov 17, 9:59pm (UTC)
Current week (Fable): 49% used · resets Nov 17, 9:59pm (UTC)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 529 requests · 15 sessions
  67%  Start fresh when you switch tasks · run /clear
  29%  Turn off MCP servers you don't use · 18k tokens per request
  Top skills: /update-config 2%, /plugin-authoring 1%

Last 7d · 642 requests · 23 sessions
  65%  Start fresh when you switch tasks · run /clear`

test('reads the Fable weekly window and skips the all-models one', async () => {
  const reading = parsePlanUsage(USAGE_TEXT, 5)
  expect(reading.modelWindows).toEqual([{ name: 'Fable', percentUsed: 49, resetText: 'Nov 17, 9:59pm' }])
  expect(reading.fetchedAt).toBe(5)
})

test('reads the last-24h block', async () => {
  expect(parsePlanUsage(USAGE_TEXT, 0).contributors).toEqual([
    'Last 24h · 529 requests · 15 sessions',
    "67%  Start fresh when you switch tasks · run /clear",
    "29%  Turn off MCP servers you don't use · 18k tokens per request",
    'Top skills: /update-config 2%, /plugin-authoring 1%',
  ])
})

test('matches the window to the model in use', async () => {
  const windows = parsePlanUsage(USAGE_TEXT, 0).modelWindows
  expect(windowForModel(windows, 'claude-fable-5-2[1m]')?.percentUsed).toBe(49)
  expect(windowForModel(windows, 'claude-opus-5-5')).toBeUndefined()
})

test('reads the result out of the JSON envelope, and rejects junk', async () => {
  expect(readResultText(JSON.stringify({ type: 'result', result: 'hi' }))).toBe('hi')
  expect(() => readResultText('{"type":"result"}')).toThrow()
})
