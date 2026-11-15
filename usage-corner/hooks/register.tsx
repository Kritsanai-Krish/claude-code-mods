import type { EngineInterface, Register } from 'claude-code'
import type { PanelTab } from '../types'
import { fitUsageLayout } from './format'
import type { CornerAction, Segment } from './format'
import { mergeLimits } from './limits'
import { readSettings } from './options'
import type { Settings } from './options'
import { drawPanel } from './panel'
import { EFFORT_LEVELS } from './panel-format'
import type { RefreshOptions } from './state'
import {
  clearLoadingFlags, raiseAlerts, readCornerState, readPanelState, readPlanUsage, readSnapshot, readTab, recordTurn,
  refreshContextView, refreshPlanUsage, refreshSnapshotSafely, resetSessionCounters, tickClock, writeTab,
} from './state'

// ---------------------------------------------------------------------------
// Room for the corner
// ---------------------------------------------------------------------------

// The footer's left side holds the permission-mode pill and the hint line.
// The corner must leave them room, or the footer wraps onto a second row.
const FOOTER_INDENT_CELLS = 2
// The longest pill is `⏵⏵ bypass permissions on `; the engine does not say which one is drawn.
const PERMISSION_PILL_CELLS = 25
// While a permission mode is on, the hint line starts with this.
const PILL_HINT_PREFIX = '(shift+tab to cycle)'
const CORNER_GAP_CELLS = 2
// Until the hint line has been seen: a pill plus `(shift+tab to cycle)`.
const DEFAULT_LEFT_SIDE_CELLS = FOOTER_INDENT_CELLS + PERMISSION_PILL_CELLS + PILL_HINT_PREFIX.length + CORNER_GAP_CELLS
// Used when the surface does not report its width (it always does on the terminal).
const UNKNOWN_WIDTH_COLUMNS = 200
const MODES_GAP = '  '

// How many cells the footer's left side takes, learned from the hint line each
// time it is drawn. A module variable: it is a measurement, re-made after a reload.
let leftSideCells = DEFAULT_LEFT_SIDE_CELLS

/** Works out the width of the footer's left side from the hint line the engine is about to draw. */
function measureLeftSide(hint: string): number {
  const pillCells = hint.startsWith(PILL_HINT_PREFIX) ? PERMISSION_PILL_CELLS : 0
  return FOOTER_INDENT_CELLS + pillCells + [...hint].length + CORNER_GAP_CELLS
}

// ---------------------------------------------------------------------------
// The popup panel
// ---------------------------------------------------------------------------

// One color for a whole part under the pointer: the terminal inverts a hovered
// button, and inverting many colors at once looked like a rainbow.
const HOVER_COLOR = 'claude'

const PANEL_ID = 'usage-panel'
const PANEL_TITLE = 'Usage'
const PANEL_COLUMNS = 64
const PANEL_ROWS = 34
const FALLBACK_BODY_COLUMNS = 60

const PANEL_TABS: readonly PanelTab[] = ['model', 'context', 'usage']

/** Which panel tab each part of the corner opens. */
const TAB_FOR_ACTION: Record<CornerAction, PanelTab> = {
  model: 'model',
  context: 'context',
  usage: 'usage',
}

// A burst of events (several turns ending close together) shares one `/usage` run.
const PLAN_USAGE_BURST_MILLISECONDS = 60_000
// After a window's reset time passes, `/usage` is asked for the new period's figures.
const PLAN_USAGE_AFTER_RESET_MILLISECONDS = 5 * 60_000
const FORCE_PLAN_USAGE = 0

// How wide the panel's body was the last time it was drawn docked beside the chat.
let dockedPanelColumns = 0

/**
 * Returns how many columns this mod's panel takes from the transcript right
 * now. The footer runs under both, so the corner may use that width too; the
 * viewport the corner is told about covers the transcript alone.
 */
async function readDockedPanelColumns($: EngineInterface): Promise<number> {
  try {
    const panes = await $.ui.panes()
    const isDocked = panes.some(pane => pane.id === PANEL_ID && pane.isShown && pane.isPlaced)
    return isDocked ? dockedPanelColumns : 0
  } catch {
    // Without the answer the corner is laid out for the transcript's width, which always fits.
    return 0
  }
}

/** Returns true when this mod's panel is open and showing. */
async function isPanelShown($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes()
  return panes.some(pane => pane.id === PANEL_ID && pane.isShown)
}

/** Switches the panel to a tab and loads what that tab needs. */
async function showTab($: EngineInterface, tab: PanelTab): Promise<void> {
  await writeTab($, tab)
  if (tab === 'context') {
    await refreshContextView($, 'full')
  }
  if (tab === 'usage') {
    await refreshPlanUsage($, FORCE_PLAN_USAGE)
  }
}

async function openPanel($: EngineInterface, tab: PanelTab): Promise<void> {
  await $.ui.open({
    id: PANEL_ID,
    title: PANEL_TITLE,
    focus: true,
    closeOnEscape: true,
    columns: PANEL_COLUMNS,
    rows: PANEL_ROWS,
  })
  await showTab($, tab)
}

/**
 * Opens the popup on a tab, or closes it when that tab is already showing
 * (a second click on the same part toggles it away).
 */
async function togglePanel($: EngineInterface, tab: PanelTab): Promise<void> {
  const currentTab = await readTab($)
  if (currentTab === tab && (await isPanelShown($))) {
    await $.ui.close({ id: PANEL_ID })
    return
  }
  await openPanel($, tab)
}

/** Switches the model with the built-in `/model <alias>`, then closes the popup. */
async function chooseModel($: EngineInterface, alias: string): Promise<void> {
  await $.ui.close({ id: PANEL_ID })
  await $.command.run({ command: 'model', args: alias })
  await refreshSnapshotSafely($, { shouldCountContext: true })
}

/** Sets the effort with the built-in `/effort <level>`; the popup stays open to show the change. */
async function chooseEffort($: EngineInterface, level: string): Promise<void> {
  await $.command.run({ command: 'effort', args: level })
  await refreshSnapshotSafely($)
}

/** Re-reads both sources of the Usage tab: the engine's figures and `/usage`. */
async function refreshUsage($: EngineInterface): Promise<void> {
  await refreshSnapshotSafely($)
  await refreshPlanUsage($, FORCE_PLAN_USAGE)
}

/** Keeps an open Context tab in step with the conversation, with the free local estimate. */
async function refreshOpenContextTab($: EngineInterface): Promise<void> {
  if ((await readTab($)) === 'context' && (await isPanelShown($))) {
    await refreshContextView($, 'summary')
  }
}

// ---------------------------------------------------------------------------
// Keeping the figures current
// ---------------------------------------------------------------------------

// The safety net under the events: whatever changes the model, effort, cost
// or limits without raising an event is picked up within this long.
const TICK_MILLISECONDS = 5_000

// Module variables: a reload drops the old timers and runs `session.start`
// again, which starts over from these initial values.
let tickTimer: { cancel: () => void } | undefined
let isTickRunning = false
let lastTickMinute = 0

/** Runs work nobody waits for: a hook must return at once, and a failure is shown, not lost. */
function runInBackground($: EngineInterface, what: string, work: Promise<void>): void {
  work.catch((error: unknown) => {
    $.ui.log(`usage-corner: could not ${what}: ${String(error)}`)
  })
}

/** Refreshes the snapshot, then warns about anything that crossed a threshold. */
async function refreshAndAlert($: EngineInterface, settings: Settings, options: RefreshOptions = {}): Promise<void> {
  await refreshSnapshotSafely($, options)
  if (settings.areAlertsEnabled) {
    await raiseAlerts($)
  }
}

/** Brings the `/usage` reading up to date (at most `maxAgeMilliseconds` old), then checks the warnings. */
async function refreshPlanUsageAndAlert($: EngineInterface, settings: Settings, maxAgeMilliseconds: number): Promise<void> {
  await refreshPlanUsage($, maxAgeMilliseconds)
  if (settings.areAlertsEnabled) {
    await raiseAlerts($)
  }
}

/** True when a limit's reset time has passed and no newer reading has replaced it. */
async function hasStaleLimit($: EngineInterface, nowMilliseconds: number): Promise<boolean> {
  const snapshot = await readSnapshot($)
  if (snapshot === null) {
    return false
  }
  return mergeLimits(snapshot, await readPlanUsage($), nowMilliseconds).some(limit => limit.hasReset)
}

/** One pass of the safety net: the engine's figures every time, the slower checks once a minute. */
async function tick($: EngineInterface, settings: Settings): Promise<void> {
  if (isTickRunning) {
    return
  }
  isTickRunning = true
  try {
    const nowMilliseconds = await tickClock($)
    await refreshSnapshotSafely($)
    const minute = Math.floor(nowMilliseconds / 60_000)
    if (minute === lastTickMinute) {
      return
    }
    lastTickMinute = minute
    if (await hasStaleLimit($, nowMilliseconds)) {
      await refreshPlanUsage($, PLAN_USAGE_AFTER_RESET_MILLISECONDS)
    } else if (settings.usageRefreshMilliseconds !== undefined) {
      // Other sessions spend the same limits; this is how an idle one hears of it.
      await refreshPlanUsage($, settings.usageRefreshMilliseconds)
    }
    if (settings.areAlertsEnabled) {
      await raiseAlerts($)
    }
  } finally {
    isTickRunning = false
  }
}

/**
 * Starts the timer and the first `/usage` read once somebody is looking at
 * the session. A headless run (`claude -p`, the SDK before a client attaches)
 * draws nowhere, so it gets neither.
 */
function startLiveUpdates($: EngineInterface, settings: Settings): void {
  if (tickTimer !== undefined) {
    return
  }
  tickTimer = $.clock.every(TICK_MILLISECONDS, () => runInBackground($, 'update the corner', tick($, settings)))
  runInBackground($, 'read /usage', refreshPlanUsageAndAlert($, settings, PLAN_USAGE_BURST_MILLISECONDS))
}

// ---------------------------------------------------------------------------
// The /corner command
// ---------------------------------------------------------------------------

/**
 * Says what a slash command that just ran tells the corner. `/effort high`
 * names the new effort itself; it is not always written to the settings file
 * (a session-only effort), so the argument is the quickest truth.
 */
function causeOfCommand(command: string, commandArguments: string): RefreshOptions {
  const level = commandArguments.trim().toLowerCase()
  if (command === 'effort' && EFFORT_LEVELS.includes(level)) {
    return { requestEffort: { level } }
  }
  return {}
}

/** Adds `/corner`. A surface that takes no commands must not cost the session its corner, so a failure is only logged. */
async function registerCornerCommand($: EngineInterface): Promise<void> {
  try {
    await $.command.register({
      name: 'corner',
      description: 'Open the usage panel: model, context or usage; "refresh" re-reads the limits',
      argumentHint: '[model|context|usage|refresh]',
    })
  } catch (error) {
    $.ui.log(`usage-corner: could not add /corner: ${String(error)}`)
  }
}

/** Answers `/corner [model|context|usage|refresh]`: the keyboard's way to what a click on the corner does. */
async function runCornerCommand($: EngineInterface, argument: string): Promise<string> {
  const word = argument.trim().toLowerCase()
  if (word === 'refresh') {
    await refreshUsage($)
    return 'Usage figures refreshed.'
  }
  const tab = PANEL_TABS.find(candidate => candidate === word) ?? (word === '' ? 'usage' : undefined)
  if (tab === undefined) {
    return `Unknown argument "${argument.trim()}". Use /corner model, context, usage or refresh.`
  }
  await openPanel($, tab)
  return `Opened the usage panel on the ${tab} tab.`
}

/**
 * Shows the model and effort, context fill, 5-hour / weekly limits (plus a
 * model's own weekly limit while on that model) and the session cost at the
 * bottom right of the prompt, kept current as things happen. Clicking a part
 * (or `/corner`) opens a popup panel on its tab: Model (switch model and
 * effort), Context (breakdown) or Usage (limits, pace and session totals).
 */
export const register: Register = (on, options) => {
  const settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await clearLoadingFlags($)
    await registerCornerCommand($)
    await refreshSnapshotSafely($, { shouldCountContext: true })
    if (e.surface !== null) {
      startLiveUpdates($, settings)
    }
    return result
  })

  // A session the desktop app or an SDK host starts draws nowhere until a client attaches.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    startLiveUpdates($, settings)
    return result
  })

  // `/clear` and `/resume` end the conversation and go on under a new session
  // id without a `session.start`: the per-conversation counters start over here.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      await resetSessionCounters($)
    }
    return next(e)
  })

  // The classic SessionStart is the one signal that the new conversation
  // (after /clear, /resume, a compaction) is in place: refill the corner.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source !== 'startup') {
      await refreshSnapshotSafely($, { shouldCountContext: true })
      runInBackground($, 'read /usage', refreshPlanUsageAndAlert($, settings, PLAN_USAGE_BURST_MILLISECONDS))
    }
    return result
  })

  // After each main-thread turn, and whenever a limit window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await refreshAndAlert($, settings, { isFromResponse: true })
    if (e.changed.includes('rateLimits')) {
      runInBackground($, 'read /usage', refreshPlanUsageAndAlert($, settings, PLAN_USAGE_BURST_MILLISECONDS))
    }
    return next(e)
  })

  // A turn of many tool calls is many model requests; the engine measures only
  // at its end. Each batch of tool results follows a response, so reading here
  // keeps context and cost moving while a long turn runs.
  on('classic.PostToolBatch', async ($, e, next) => {
    const result = await next(e)
    const isMainLoop = e.agent_id === undefined
    const cause: RefreshOptions = isMainLoop ? { isFromResponse: true, requestEffort: { level: e.effort?.level } } : { isFromResponse: true }
    runInBackground($, 'update the corner', refreshAndAlert($, settings, cause))
    return result
  })

  // The main loop's turn end carries the effort the turn ran with.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    runInBackground($, 'update the corner', refreshSnapshotSafely($, { isFromResponse: true, requestEffort: { level: e.effort?.level } }))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const isMainLoop = e.agentId === undefined
    await recordTurn($, { durationMs: e.durationMs, reason: e.reason, usage: e.usage }, isMainLoop)
    // A subagent's run moves the cost and the limits too.
    const cause: RefreshOptions = isMainLoop && e.usage !== undefined ? { isFromResponse: true, answeringModel: e.usage.model } : {}
    runInBackground($, 'update the corner', refreshAndAlert($, settings, cause))
    if (isMainLoop) {
      runInBackground($, 'recount the context', refreshOpenContextTab($))
    }
    return result
  })

  // A turn that died on an API error is often a limit just hit: ask `/usage` now.
  on('classic.StopFailure', async ($, e, next) => {
    const result = await next(e)
    runInBackground($, 'read /usage', refreshPlanUsageAndAlert($, settings, FORCE_PLAN_USAGE))
    return result
  })

  // After a compaction (/compact or automatic) the API has no count of the new,
  // smaller conversation until the next reply: estimate it.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    runInBackground($, 'update the corner', refreshAndAlert($, settings, { shouldCountContext: true }))
    runInBackground($, 'recount the context', refreshOpenContextTab($))
    return result
  })

  // Every way the model changes: /model, the picker, the /config row, fast
  // mode, an automatic fallback, a resume.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refreshSnapshotSafely($, { shouldCountContext: true })
    return result
  })

  // A /config row (model, auto-compact) or a settings file changed.
  on('config.set', async ($, e, next) => {
    const result = await next(e)
    runInBackground($, 'update the corner', refreshSnapshotSafely($))
    return result
  })
  on('classic.ConfigChange', async ($, e, next) => {
    const result = await next(e)
    runInBackground($, 'update the corner', refreshSnapshotSafely($))
    return result
  })

  on('command.run', { command: 'corner' }, async ($, e) => {
    return { text: await runCornerCommand($, e.args) }
  })

  // Any other slash command may change what the corner shows (/effort, /fast,
  // /login, /model's picker): read again once it has run.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    if (e.command !== 'corner') {
      runInBackground($, 'update the corner', refreshSnapshotSafely($, causeOfCommand(e.command, e.args)))
    }
    return result
  })

  // Only to learn how wide the footer's left side is; the hint is drawn as it came.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const measuredCells = measureLeftSide(e.props.hint)
    if (measuredCells !== leftSideCells) {
      leftSideCells = measuredCells
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const { snapshot, planUsage } = await readCornerState($)
    if (snapshot === null) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    // The engine's own mode labels (focus, memory paused) and other mods' drawings stay in front.
    const beneath = await next(e)
    const gap = e.props.modes.length > 0 ? MODES_GAP : ''
    const modesCells = [...e.props.modes.join(' & ')].length + gap.length
    const transcriptColumns = e.viewport?.columns ?? UNKNOWN_WIDTH_COLUMNS
    const columns = transcriptColumns + (await readDockedPanelColumns($))
    const nowMilliseconds = await $.clock.now()
    const layout = fitUsageLayout(
      {
        snapshot,
        limits: mergeLimits(snapshot, planUsage, nowMilliseconds),
        nowMilliseconds,
        iconStyle: settings.iconStyle,
        isCostShown: settings.isCostShown,
      },
      columns - leftSideCells - modesCells,
    )

    // `hoverScope` names the part this run belongs to, so the whole part
    // turns one color together while the pointer is over any of it.
    const drawSegment = (segment: Segment, hoverScope?: string) => (
      <Text
        color={segment.color}
        bold={segment.isBold}
        dimColor={segment.isDim}
        hover={hoverScope === undefined ? undefined : { scope: hoverScope, color: HOVER_COLOR, dimColor: false }}
      >
        {segment.text}
      </Text>
    )
    const parts = []
    for (const [index, group] of layout.groups.entries()) {
      if (index > 0) {
        parts.push(drawSegment(layout.separator))
      }
      const hoverScope = `corner-${group.key}`
      const tab = TAB_FOR_ACTION[group.action]
      parts.push(
        <Button
          key={group.key}
          plain
          hover={{ scope: hoverScope, color: HOVER_COLOR, dimColor: false }}
          onPress={() => runInBackground($, `open the ${tab} panel`, togglePanel($, tab))}
        >
          {group.segments.map(segment => drawSegment(segment, hoverScope))}
        </Button>,
      )
    }
    return (
      <Box flexDirection="row">
        {beneath}
        <Text>{gap}</Text>
        {parts}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANEL_ID }, async ($, e) => {
    const ui = $.ui.resolve(e)
    dockedPanelColumns = e.props.placement === 'dock' ? e.props.bodyColumns : 0
    const data = {
      ...(await readPanelState($)),
      iconStyle: settings.iconStyle,
      bodyColumns: e.props.bodyColumns > 0 ? e.props.bodyColumns : FALLBACK_BODY_COLUMNS,
      nowMilliseconds: await $.clock.now(),
    }
    return drawPanel(ui, data, {
      selectTab: tab => runInBackground($, `show the ${tab} tab`, showTab($, tab)),
      chooseModel: alias => runInBackground($, `switch to ${alias}`, chooseModel($, alias)),
      chooseEffort: level => runInBackground($, `set effort to ${level}`, chooseEffort($, level)),
      refreshContext: () => runInBackground($, 'count the context', refreshContextView($, 'full')),
      refreshUsage: () => runInBackground($, 'refresh usage', refreshUsage($)),
    })
  })
}
