import { expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown } from 'claude-code'
import { describeReset, formatAge, formatDuration, isCurrentModel, MODEL_CHOICES, toContextView } from './panel-format'

const NOW = Date.parse('2026-11-15T12:00:00Z')

const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'Messages', tokens: 121_300, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 808_700, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 158_300, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, autocompactSource: 'model-default', percentage: 16,
  gridRows: [[{ color: 'permission', isFilled: true, categoryName: 'Messages', tokens: 121_300, percentage: 12, squareFullness: 1 }]],
  model: 'claude-opus-5-5',
  memoryFiles: [
    { path: '/home/me/.claude/CLAUDE.md', type: 'User', tokens: 2_400 },
    { path: '/work/app/CLAUDE.md', type: 'Project', tokens: 900 },
  ],
  mcpTools: [
    { name: 'mcp__figma__a', serverName: 'figma', tokens: 5_000, isLoaded: true },
    { name: 'mcp__figma__b', serverName: 'figma', tokens: 4_000, isLoaded: true },
    { name: 'mcp__gmail__send', serverName: 'gmail', tokens: 1_000, isLoaded: false },
  ],
  agents: [{ agentType: 'reviewer', source: 'user', tokens: 300 }],
  skills: { totalSkills: 40, includedSkills: 38, tokens: 6_100, skillFrontmatter: [] },
  autoCompactThreshold: 967_000, isAutoCompactEnabled: true, apiUsage: null,
}

test('the breakdown becomes a view with its largest items, biggest first', async () => {
  const view = toContextView(BREAKDOWN, true, NOW)
  expect(view.largestItems).toEqual([
    { label: 'figma', detail: 'MCP server · 2 tools', tokens: 9_000 },
    { label: 'Skill list', detail: '38 of 40 skills', tokens: 6_100 },
    { label: 'CLAUDE.md', detail: 'User memory · /home/me/.claude', tokens: 2_400 },
    { label: 'CLAUDE.md', detail: 'Project memory · /work/app', tokens: 900 },
    { label: 'reviewer', detail: 'agent · user', tokens: 300 },
  ])
  expect([view.totalTokens, view.maxTokens, view.percentage, view.autoCompactThreshold, view.isExact, view.countedAt])
    .toEqual([158_300, 1_000_000, 16, 967_000, true, NOW])
})

test('tools that load on demand are not counted as taking room', async () => {
  const view = toContextView(BREAKDOWN, false, NOW)
  expect(view.largestItems.some(item => item.label === 'gmail')).toBe(false)
})

test('the current model is matched by family, whatever suffix or date the id carries', async () => {
  const opus = MODEL_CHOICES.find(choice => choice.alias === 'opus')!
  expect(isCurrentModel(opus, 'claude-opus-5-5[1m]')).toBe(true)
  expect(isCurrentModel(opus, 'claude-opus-4-1-20250805')).toBe(true)
  expect(isCurrentModel(opus, 'claude-sonnet-5-5')).toBe(false)
})

test('durations and ages read naturally', async () => {
  expect(formatDuration(7_230)).toBe('7s')
  expect(formatDuration(134 * 60_000)).toBe('2h14m')
  expect(formatAge(4_000)).toBe('just now')
  expect(formatAge(45_000)).toBe('45s ago')
  expect(formatAge(5 * 60_000)).toBe('5m ago')
})

test('a reset is described by its countdown, its printed time, or as done', async () => {
  const base = { kind: 'five_hour', title: '5-hour limit', percentUsed: 20, resetText: '', hasReset: false }
  expect(describeReset({ ...base, resetsAtMilliseconds: NOW + 80 * 60_000 }, NOW)).toBe('resets in 1h20m')
  expect(describeReset({ ...base, resetText: 'Nov 17, 10pm' }, NOW)).toBe('resets Nov 17, 10pm')
  expect(describeReset({ ...base, percentUsed: 0, hasReset: true }, NOW)).toBe('has reset · waiting for a new reading')
  expect(describeReset(base, NOW)).toBe('')
})
