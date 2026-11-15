import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionContextBreakdown, SessionUsage } from 'claude-code'

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
  memoryFiles: [{ path: '/home/test/.claude/CLAUDE.md', type: 'User', tokens: 2_400 }],
  mcpTools: [], agents: [],
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

const USAGE_TEXT = [
  'Current session: 5% used · resets Nov 15, 3:50pm (UTC)',
  'Current week (all models): 50% used · resets Nov 17, 3pm (UTC)',
  'Current week (Fable): 49% used · resets Nov 17, 3pm (UTC)',
  '',
  'Last 24h · 529 requests · 15 sessions',
  '  67%  Start fresh when you switch tasks · run /clear',
].join('\n')

const PANE_PROPS = {
  title: 'Usage', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {},
} as const

const PRESENTATION = { isFullscreen: true, columns: 200 } as const

/** The world beneath the mod: what the engine would answer, changeable while a test runs. */
type World = {
  model: string
  usage: SessionUsage
  usageText: string
  modelSettings: Record<string, { effortLevel: string }>
  commands: string[]
  usageRuns: string[][]
  toasts: string[]
  openPanes: Set<string>
  clock: ReturnType<typeof mock.clock>
}

/** Registers the engine's answers and starts an interactive session with the mod loaded. */
async function startSession($: Engine, on: On, surface: 'terminal' | null = 'terminal'): Promise<World> {
  const world: World = {
    model: 'claude-opus-5-5', usage: USAGE, usageText: USAGE_TEXT, modelSettings: {},
    commands: [], usageRuns: [], toasts: [], openPanes: new Set(),
    clock: mock.clock(on, { now: NOW }),
  }
  mock.store(on)
  mock.env(on, { CLAUDE_CODE_EXECPATH: '/opt/claude', HOME: '/home/test' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', (_, e) => ({
    value: e?.breakdown ? { ...world.usage, context: { ...world.usage.context, breakdown: BREAKDOWN } } : world.usage,
  }))
  on('session.model', () => ({ value: world.model }))
  on('settings.read', () => ({ value: { modelSettings: world.modelSettings } }))
  on('ui.open', (_, e) => { world.openPanes.add(e.id); return { value: { isPlaced: true } } })
  on('ui.close', (_, e) => { world.openPanes.delete(e.id); return { value: undefined } })
  on('ui.panes', () => ({ value: [...world.openPanes].map(id => ({ id, title: 'Usage', isShown: true, isFocused: true, isPlaced: true })) }))
  on('ui.toast', (_, e) => { world.toasts.push(e.text); return { value: undefined } })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.compact', (_, e) => ({ messages: e.messages }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.PostToolBatch', () => ({}))
  on('command.run', (_, e) => { world.commands.push(`${e.command} ${e.args}`.trim()); return { text: '' } })
  on('process.run', (_, e) => {
    world.usageRuns.push([...e.argv])
    return { value: { exitCode: 0, stdout: JSON.stringify({ result: world.usageText }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/', surface, isInteractive: surface !== null })
  await world.clock.settle()
  return world
}

/** Draws the corner as the footer would and returns its text. */
async function readCorner($: Engine, columns = 200): Promise<string> {
  const corner = await $.ui.mount({
    plugin: 'usage-corner', surface: 'terminal', component: 'SessionMode', props: { modes: [] },
    viewport: { columns, rows: 40 },
  })
  const texts = await corner.findAll({ type: 'Text' })
  await corner.unmount()
  // Nested Text is found too; the leaves are the ones without Text children.
  return texts.filter(text => text.children.every(child => typeof child === 'string')).map(text => text.text).join('')
}

test('the corner shows model, context, limits and cost from the first moment', async ($, on) => {
  await startSession($, on)
  expect(await readCorner($)).toBe(
    '\u{F06A9} Opus 5.5  │  \u{F09D1} ▰▱▱▱▱ 16% 158k/1M  │  \u{F051F} 5h ▰▱▱▱▱ 5% ↻3h50m  │  \u{F0A33} wk ▰▰▰▱▱ 50% ↻2d3h  │  \u{F01C1}1.70',
  )
})

test('a model switch shows at once, whoever made it', async ($, on) => {
  const world = await startSession($, on)
  world.model = 'claude-fable-5-2'
  await $.classic.PostModelSwitch({ from_model: 'claude-opus-5-5', to_model: 'claude-fable-5-2', requested_model: 'fable', source: 'picker',
    context_tokens: 0, estimated_cache_write_usd: 0, prompt_cache_warm: false, cache_ttl: '5m', pricing: 'default',
  })
  const corner = await readCorner($, 240)
  expect(corner).toContain('Fable 5.2')
  // Fable's own weekly window, known from /usage, joins the corner.
  expect(corner).toContain('\u{F0AE2} Fable ▰▰▱▱▱ 49% ↻2d3h')
})

test('a change nothing announced is picked up by the next tick', async ($, on) => {
  const world = await startSession($, on)
  world.model = 'claude-haiku-5-5'
  world.usage = { ...USAGE, cost: { usd: 2.5 } }
  await world.clock.advance(5_000)
  const corner = await readCorner($)
  expect(corner).toContain('Haiku 5.5')
  expect(corner).toContain('\u{F01C1}2.50')
})

test('countdowns move with the clock while the session sits idle', async ($, on) => {
  const world = await startSession($, on)
  await world.clock.advance(10 * 60_000)
  expect(await readCorner($)).toContain('↻3h40m')
})

test('context, cost and effort move during a long turn, after each batch of tool calls', async ($, on) => {
  const world = await startSession($, on)
  world.usage = { ...USAGE, context: { tokens: 300_000, window: 1_000_000, percent: 30 }, cost: { usd: 3.21 } }
  await $.classic.PostToolBatch({ tool_calls: [], effort: { level: 'high' } })
  await world.clock.settle()
  const corner = await readCorner($)
  expect(corner).toContain('Opus 5.5 · high')
  expect(corner).toContain('30% 300k/1M')
  expect(corner).toContain('\u{F01C1}3.21')
})

test('/effort shows before the next reply', async ($, on) => {
  const world = await startSession($, on)
  // Nothing in the settings file: `--setting-sources ''`, or an effort kept for this session only.
  await $.command.run({ command: 'effort', args: 'low', origin: { kind: 'composer' }, presentation: PRESENTATION })
  await world.clock.settle()
  expect(await readCorner($)).toContain('Opus 5.5 · low')
})

test('an effort written to the settings file by anything else is noticed too', async ($, on) => {
  const world = await startSession($, on)
  world.modelSettings = { 'claude-opus-5-5': { effortLevel: 'max' } }
  await world.clock.advance(5_000)
  expect(await readCorner($)).toContain('Opus 5.5 · max')
})

test('after a compaction the context is a marked estimate until the next reply', async ($, on) => {
  const world = await startSession($, on)
  world.usage = { ...USAGE, context: { window: 1_000_000 } }
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hello', toolUses: [] }] })
  await world.clock.settle()
  expect(await readCorner($)).toContain('~16% ~158k/1M')
})

test('when the engine drops its count a moment after the compaction, the next tick estimates', async ($, on) => {
  const world = await startSession($, on)
  await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'hello', toolUses: [] }] })
  await world.clock.settle()
  expect(await readCorner($)).toContain('16% 158k/1M')
  world.usage = { ...USAGE, context: { window: 1_000_000 } }
  await world.clock.advance(5_000)
  expect(await readCorner($)).toContain('~16% ~158k/1M')
})

test('a fallback model that answered the turn is pointed out', async ($, on) => {
  const world = await startSession($, on)
  await $.turn.complete({
    answer: 'ok', durationMs: 4_000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 95, model: 'claude-sonnet-5-5' },
  })
  await world.clock.settle()
  expect(await readCorner($, 240)).toContain('Opus 5.5 → Sonnet 5.5')
})

test('a limit that crosses 80% warns once, and its reset is announced', async ($, on) => {
  const world = await startSession($, on)
  const hot = [{ kind: 'five_hour', percentUsed: 83, resetsAt: '2026-11-15T15:50:00Z' }]
  world.usage = { ...USAGE, rateLimits: hot }
  world.usageText = ''
  await $.session.measure({ context: world.usage.context, rateLimits: hot, changed: ['rateLimits'] })
  await world.clock.settle()
  expect(world.toasts).toEqual(['⚠ 5-hour limit at 83% · resets in 3h50m'])
  await $.session.measure({ context: world.usage.context, rateLimits: hot, changed: ['cost'] })
  await world.clock.settle()
  expect(world.toasts).toHaveLength(1)

  // The reset time passes while the session is idle: the stale 83% is not shown any more.
  world.usageText = 'Current session: 1% used · resets Nov 15, 8:50pm (UTC)'
  await world.clock.advance(4 * 60 * 60_000)
  expect(world.toasts).toEqual(['⚠ 5-hour limit at 83% · resets in 3h50m', '✓ 5-hour limit has reset'])
  expect(await readCorner($)).toContain('5h ▰▱▱▱▱ 1% ↻4h50m')
})

test('an idle session re-reads /usage on its schedule, and a fresh shared reading saves the run', async ($, on) => {
  const world = await startSession($, on)
  expect(world.usageRuns).toHaveLength(1)
  await world.clock.advance(2 * 60_000)
  expect(world.usageRuns).toHaveLength(1)
  await world.clock.advance(2 * 60_000)
  expect(world.usageRuns).toHaveLength(2)
  expect(world.usageRuns[0]?.slice(0, 3)).toEqual(['/opt/claude', '-p', '/usage'])
})

test('a headless run starts no timer and no /usage child', async ($, on) => {
  const world = await startSession($, on, null)
  await world.clock.advance(10 * 60_000)
  expect(world.usageRuns).toHaveLength(0)
})

test('/clear starts the session totals over', async ($, on) => {
  const world = await startSession($, on)
  await $.turn.complete({
    answer: 'ok', durationMs: 4_000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 95, model: 'claude-opus-5-5' },
  })
  await world.clock.settle()
  const openUsageTab = async () => {
    world.openPanes.add('usage-panel')
    return $.ui.mount({ plugin: 'usage-corner', surface: 'terminal', component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
  }
  let pane = await openUsageTab()
  expect(await pane.find({ type: 'Text', text: /1 turn/ }), 'turn counted').toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /cached 900 \(90%\)/ }), 'cache share').toBeTruthy()
  await pane.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  pane = await openUsageTab()
  expect(await pane.find({ type: 'Text', text: /1 turn/ }), 'totals cleared').toBeFalsy()
  await pane.unmount()
})

test('/corner opens the panel from the keyboard and refreshes on demand', async ($, on) => {
  const world = await startSession($, on)
  const answer = await $.command.run({ command: 'corner', args: 'context', origin: { kind: 'composer' }, presentation: PRESENTATION })
  expect(answer.text).toBe('Opened the usage panel on the context tab.')
  expect(world.openPanes.has('usage-panel')).toBe(true)
  const runsBefore = world.usageRuns.length
  expect((await $.command.run({ command: 'corner', args: 'refresh', origin: { kind: 'composer' }, presentation: PRESENTATION })).text).toBe('Usage figures refreshed.')
  expect(world.usageRuns.length).toBe(runsBefore + 1)
  expect((await $.command.run({ command: 'corner', args: 'nope', origin: { kind: 'composer' }, presentation: PRESENTATION })).text).toContain('Unknown argument "nope"')
})

test('the corner gives the footer\'s left side the room its hint line needs', async ($, on) => {
  await startSession($, on)
  const drawHint = async (hint: string) => {
    const hintLine = await $.ui.mount({
      plugin: 'usage-corner', surface: 'terminal', component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint }, viewport: { columns: 130, rows: 40 },
    })
    await hintLine.unmount()
  }
  // With a permission pill on the left there is room for the meters but not the token counts.
  await drawHint('(shift+tab to cycle)')
  expect(await readCorner($, 130)).not.toContain('158k/1M')
  // Without one, the same width fits the full corner.
  await drawHint('? for shortcuts')
  expect(await readCorner($, 130)).toContain('158k/1M')
})

test('while the panel is docked beside the chat, the corner still uses the footer\'s full width', async ($, on) => {
  const world = await startSession($, on)
  // The transcript, and so the viewport the corner is told, is narrower by the panel.
  expect(await readCorner($, 96)).not.toContain('▰')
  world.openPanes.add('usage-panel')
  const pane = await $.ui.mount({ plugin: 'usage-corner', surface: 'terminal', component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
  expect(await readCorner($, 96)).toContain('▰▱▱▱▱ 16%')
  await pane.unmount()
  world.openPanes.delete('usage-panel')
  expect(await readCorner($, 96)).not.toContain('▰')
})

test('clicking corner parts opens the popup on the right tab, and the tabs work', async ($, on) => {
  const world = await startSession($, on)
  for (const surface of ['terminal', 'desktop'] as const) {
    world.commands.length = 0
    const corner = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'SessionMode', props: { modes: [] } })

    // Usage part: opens the popup on the Usage tab.
    await corner.press({ key: 'limit-seven_day' })
    expect(world.openPanes.has('usage-panel')).toBe(true)
    let pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /Weekly limit/ }), 'usage tab').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /resets in 2d3h/ }), 'reset time').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /at this pace: about \d+% by the reset/ }), 'pace').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /\$1\.70/ }), 'cost').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Fable weekly limit/ }), 'fable window from /usage').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Checked with \/usage just now/ }), 'reading age').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Start fresh/ }), 'contributors').toBeTruthy()
    await pane.unmount()

    // Same part again: toggles the popup closed.
    await corner.press({ key: 'limit-seven_day' })
    expect(world.openPanes.has('usage-panel')).toBe(false)

    // Context part: opens on the Context tab with the breakdown.
    await corner.press({ key: 'context' })
    pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /158k \/ 1M/ }), 'context total').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Messages/ }), 'category row').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Largest items/ }), 'largest items').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Auto-compact at 967k tokens \(809k to go\)/ }), 'autocompact').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /Counted just now \(exact\)\./ }), 'count kind').toBeTruthy()

    // Tab bar: switch to Model, set the effort, then pick Fable.
    await pane.press({ key: 'tab-model' })
    await pane.unmount()
    pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /current/ }), 'current marker').toBeTruthy()
    await pane.press({ key: 'effort-high' })
    expect(world.commands).toEqual(['effort high'])
    expect(world.openPanes.has('usage-panel')).toBe(true)
    await pane.press({ key: 'model-fable' })
    expect(world.commands).toEqual(['effort high', 'model fable'])
    expect(world.openPanes.has('usage-panel')).toBe(false)
    await pane.unmount()

    // Model part on the corner opens the Model tab; there is no second close mark of our own.
    await corner.press({ key: 'model' })
    pane = await $.ui.mount({ plugin: 'usage-corner', surface, component: 'Pane', requestId: 'usage-panel', props: PANE_PROPS })
    expect(await pane.find({ type: 'Text', text: /Switch model/ }), 'model tab').toBeTruthy()
    expect(await pane.find({ type: 'Text', text: /✕/ }), 'no own close mark').toBeFalsy()
    await pane.unmount()
    await corner.press({ key: 'model' })
    expect(world.openPanes.has('usage-panel')).toBe(false)
    await corner.unmount()
  }
})

test('plain symbols and no cost when the options say so', { options: { icons: 'unicode', showCost: false } }, async ($, on) => {
  await startSession($, on)
  expect(await readCorner($)).toBe('◆ Opus 5.5  │  ◔ ▰▱▱▱▱ 16% 158k/1M  │  ◷ 5h ▰▱▱▱▱ 5% ↻3h50m  │  ▤ wk ▰▰▰▱▱ 50% ↻2d3h')
})

test('warnings can be turned off', { options: { alerts: false } }, async ($, on) => {
  const world = await startSession($, on)
  const hot = [{ kind: 'five_hour', percentUsed: 97, resetsAt: '2026-11-15T15:50:00Z' }]
  world.usage = { ...USAGE, rateLimits: hot }
  await $.session.measure({ context: world.usage.context, rateLimits: hot, changed: ['rateLimits'] })
  await world.clock.settle()
  expect(world.toasts).toEqual([])
})
