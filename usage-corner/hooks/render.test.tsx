import { expect, test } from 'claude-code/testing'
import type { SessionContextBreakdown, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-11-15T12:00:00Z')

const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 3_100, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 121_300, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 808_700, color: 'inactive', isDeferred: false, kind: 'free' },
    { name: 'MCP tools (deferred)', tokens: 257_400, color: 'inactive', isDeferred: true, kind: 'deferred' },
  ],
  totalTokens: 158_300,
  maxTokens: 1_000_000,
  rawMaxTokens: 1_000_000,
  autocompactSource: 'model-default',
  percentage: 16,
  gridRows: [[
    { color: 'permission', isFilled: true, categoryName: 'Messages', tokens: 121_300, percentage: 12, squareFullness: 1 },
    { color: 'inactive', isFilled: false, categoryName: 'Free space', tokens: 808_700, percentage: 81, squareFullness: 0 },
  ]],
  model: 'claude-opus-5-5',
  memoryFiles: [], mcpTools: [], agents: [],
  autoCompactThreshold: 967_000,
  isAutoCompactEnabled: true,
  apiUsage: null,
}

const USAGE: SessionUsage = {
  startedAt: NOW - 2 * 60 * 60_000 - 14 * 60_000,
  context: { tokens: 158_300, window: 1_000_000, percent: 16 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 5, resetsAt: '2026-11-15T15:50:00Z' },
    { kind: 'seven_day', percentUsed: 50, resetsAt: '2026-11-17T15:00:00Z' },
  ],
  cost: { usd: 1.7 },
}

const PANE_PROPS = {
  title: 'Usage', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {},
} as const

test('clicking corner parts opens the popup on the right tab, and the tabs work', async ($, on) => {
  const commands: string[] = []
  const openPanes = new Set<string>()
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', (_, e) => ({ value: e?.breakdown ? { ...USAGE, context: { ...USAGE.context, breakdown: BREAKDOWN } } : USAGE }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: NOW }))
  on('ui.open', (_, e) => { openPanes.add(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { openPanes.delete(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [...openPanes].map(id => ({ id, title: 'Usage', isShown: true, isFocused: true, isPlaced: true })) }))
  on('command.run', (_, e) => { commands.push(`${e.command} ${e.args}`); return { text: '' } })
  const usageRuns: string[][] = []
  on('env.get', (_, e) => ({ value: e.name === 'CLAUDE_CODE_EXECPATH' ? '/opt/claude' : '/home/test' }))
  on('process.run', (_, e) => {
    usageRuns.push([...e.argv])
    const result = 'Current week (all models): 50% used · resets Nov 17, 9:59pm (UTC)\nCurrent week (Fable): 49% used · resets Nov 17, 9:59pm (UTC)\n\nLast 24h · 529 requests · 15 sessions\n  67%  Start fresh when you switch tasks · run /clear'
    return { value: { exitCode: 0, stdout: JSON.stringify({ result }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    commands.length = 0
    const corner = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'SessionMode', props: { modes: [] } })

    // Usage part: opens the popup on the Usage tab.
    await corner.press({ key: 'limit-1' })
    expect(openPanes.has('usage-panel')).toBe(true)
    let pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /Weekly limit/ }), 'usage tab').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /resets in 2d3h/ }), 'reset time').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /\$1\.70/ }), 'cost').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Fable weekly limit/ }), 'fable window from /usage').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /resets Nov 17, 9:59pm$/ }), 'fable reset').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Start fresh/ }), 'contributors').toBeTruthy()
    expect(usageRuns.at(-1)?.slice(0, 3)).toEqual(['/opt/claude', '-p', '/usage'])
    await pane.unmount()

    // Same part again: toggles the popup closed.
    await corner.press({ key: 'limit-1' })
    expect(openPanes.has('usage-panel')).toBe(false)

    // Context part: opens on the Context tab with the breakdown.
    await corner.press({ key: 'context' })
    pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /158k \/ 1M/ }), 'context total').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Messages/ }), 'category row').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Auto-compact at 967k/ }), 'autocompact').toBeTruthy()

    // Tab bar: switch to Model, then pick Fable.
    await pane.press({ key: 'tab-model' })
    await pane.unmount()
    pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /current/ }), 'current marker').toBeTruthy()
    await pane.press({ key: 'model-fable' })
    expect(commands).toEqual(['model fable'])
    expect(openPanes.has('usage-panel')).toBe(false)
    await pane.unmount()

    // Model part on the corner opens the Model tab; there is no second close mark of our own.
    await corner.press({ key: 'model' })
    pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /Switch model/ }), 'model tab').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /✕/ }), 'no own close mark').toBeFalsy()
    await pane.unmount()
    await corner.press({ key: 'model' })
    expect(openPanes.has('usage-panel')).toBe(false)
    await corner.unmount()
  }
})
