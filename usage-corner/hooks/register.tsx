import type { EngineInterface, Register } from 'claude-code'
import type { PanelTab, PlanUsage, UsageSnapshot } from '../types'
import { MODEL_WINDOW_KIND_PREFIX, fitUsageLayout, formatTimeUntil } from './format'
import type { CornerAction, Segment } from './format'
import { warnAboutLimits } from './alerts'
import type { WatchedWindow } from './alerts'
import { drawPanel } from './panel'
import { windowForModel } from './plan-usage'
import {
  readPanelState, readPlanUsage, readSnapshot, readTab, refreshContextView, refreshPlanUsage,
  refreshSnapshotSafely, writeTab,
} from './state'

// The footer's left side holds the hint line (`? for shortcuts`, `esc to
// interrupt`); keep this many cells free for it so the corner never pushes it off.
const LEFT_HINT_RESERVED_CELLS = 26
// Used when the surface does not report its width (it always does on the terminal).
const UNKNOWN_WIDTH_COLUMNS = 200
const MODES_GAP = '  '

// One color for a whole part under the pointer: the terminal inverts a hovered
// button, and inverting many colors at once looked like a rainbow.
const HOVER_COLOR = 'claude'

const PANEL_ID = 'usage-panel'
const PANEL_TITLE = 'Usage'
const PANEL_COLUMNS = 60
const PANEL_ROWS = 30
const FALLBACK_BODY_COLUMNS = 60

/** Which panel tab each part of the corner opens. */
const TAB_FOR_ACTION: Record<CornerAction, PanelTab> = {
  model: 'model',
  context: 'context',
  usage: 'usage',
}

/** Returns true when this mod's panel is open and showing. */
async function isPanelShown($: EngineInterface): Promise<boolean> {
  const panes = await $.ui.panes()
  return panes.some(pane => pane.id === PANEL_ID && pane.isShown)
}

/** Switches the panel to a tab, counting the context window when that tab needs it. */
async function showTab($: EngineInterface, tab: PanelTab): Promise<void> {
  await writeTab($, tab)
  if (tab === 'context') {
    await refreshContextView($)
  }
  if (tab === 'usage') {
    await refreshPlanUsage($, true)
  }
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

/** Switches the model with the built-in `/model <alias>`, then closes the popup. */
async function chooseModel($: EngineInterface, alias: string): Promise<void> {
  await $.ui.close({ id: PANEL_ID })
  await $.command.run({ command: 'model', args: alias })
  await refreshSnapshotSafely($)
}

/** Re-reads both sources of the Usage tab: the headers' figures and `/usage`. */
async function refreshUsage($: EngineInterface): Promise<void> {
  await refreshSnapshotSafely($)
  await refreshPlanUsage($, true)
}

/**
 * Adds the model's own weekly window (Fable's, from `/usage`) to the header
 * figures, so the corner can show it beside 5h and weekly while on that model.
 */
function withModelWindow(snapshot: UsageSnapshot, planUsage: PlanUsage | null): UsageSnapshot {
  const window = planUsage === null ? undefined : windowForModel(planUsage.modelWindows, snapshot.model)
  if (window === undefined) {
    return snapshot
  }
  const kind = `${MODEL_WINDOW_KIND_PREFIX}${window.name.toLowerCase()}`
  return { ...snapshot, limits: [...snapshot.limits, { kind, percentUsed: window.percentUsed }] }
}

const WINDOW_TITLES: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  spend_limit: 'Spend limit',
}

/**
 * Lists every limit window with a reading: the headers' (5h, weekly) and
 * each model's own weekly window from `/usage` (Fable's), keyed by window
 * and reset time so each reset period warns afresh.
 */
async function collectWatchedWindows($: EngineInterface): Promise<WatchedWindow[]> {
  const snapshot = await readSnapshot($)
  const planUsage = await readPlanUsage($)
  const now = await $.clock.now()
  const windows: WatchedWindow[] = []
  for (const limit of snapshot?.limits ?? []) {
    const resetIn = formatTimeUntil(limit.resetsAt, now)
    windows.push({
      windowKey: `${limit.kind}@${limit.resetsAt ?? 'unknown'}`,
      title: WINDOW_TITLES[limit.kind] ?? limit.kind,
      percentUsed: limit.percentUsed,
      resetText: resetIn === '' ? '' : `in ${resetIn}`,
    })
  }
  for (const window of planUsage?.modelWindows ?? []) {
    windows.push({
      windowKey: `${MODEL_WINDOW_KIND_PREFIX}${window.name.toLowerCase()}@${window.resetText}`,
      title: `${window.name} weekly limit`,
      percentUsed: window.percentUsed,
      resetText: window.resetText,
    })
  }
  return windows
}

/** Warns (a toast) when any limit window reaches 80% or 95%, once each per reset period. */
async function checkLimitAlerts($: EngineInterface): Promise<void> {
  await warnAboutLimits($, await collectWatchedWindows($))
}

/** After `/usage` is read, the Fable window may have crossed a threshold too. */
async function refreshPlanUsageAndAlert($: EngineInterface, isForced: boolean): Promise<void> {
  await refreshPlanUsage($, isForced)
  await checkLimitAlerts($)
}

/** Runs a press's work in the background: a press must return at once, and a failure is shown, not lost. */
function runInBackground($: EngineInterface, what: string, work: Promise<void>): void {
  work.catch((error: unknown) => {
    $.ui.toast(`usage-corner: could not ${what}: ${String(error)}`)
  })
}

/**
 * Shows the model, context fill, 5-hour / weekly limits (plus Fable's own
 * weekly limit while on Fable) and the session cost at the bottom right of
 * the prompt. Clicking a part opens a popup panel on its tab: Model (switch),
 * Context (breakdown) or Usage (limits and cost); Esc or ✕ closes it.
 */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refreshSnapshotSafely($)
    // Not awaited: the child `claude -p /usage` takes over a second, and the
    // session start must not wait for it.
    runInBackground($, 'read /usage', refreshPlanUsageAndAlert($, false))
    return result
  })

  on('session.measure', async ($, e, next) => {
    await refreshSnapshotSafely($)
    if (e.changed.includes('rateLimits')) {
      runInBackground($, 'check limit alerts', checkLimitAlerts($))
      runInBackground($, 'read /usage', refreshPlanUsageAndAlert($, false))
    }
    return next(e)
  })

  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refreshSnapshotSafely($)
    return result
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const headerSnapshot = await readSnapshot($)
    if (headerSnapshot === null) {
      return next(e)
    }
    const snapshot = withModelWindow(headerSnapshot, await readPlanUsage($))
    const { Box, Button, Text } = $.ui.resolve(e)
    // The engine's own mode labels (focus, memory paused) and other mods' drawings stay in front.
    const beneath = await next(e)
    const gap = e.props.modes.length > 0 ? MODES_GAP : ''
    const modesCells = [...e.props.modes.join(' & ')].length + gap.length
    const columns = e.viewport?.columns ?? UNKNOWN_WIDTH_COLUMNS
    const availableCells = columns - LEFT_HINT_RESERVED_CELLS - modesCells
    const layout = fitUsageLayout(snapshot, await $.clock.now(), availableCells)

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
    const data = {
      ...(await readPanelState($)),
      bodyColumns: e.props.bodyColumns > 0 ? e.props.bodyColumns : FALLBACK_BODY_COLUMNS,
      nowMilliseconds: await $.clock.now(),
    }
    return drawPanel(ui, data, {
      selectTab: tab => runInBackground($, `show the ${tab} tab`, showTab($, tab)),
      chooseModel: alias => runInBackground($, `switch to ${alias}`, chooseModel($, alias)),
      refreshContext: () => runInBackground($, 'count the context', refreshContextView($)),
      refreshUsage: () => runInBackground($, 'refresh usage', refreshUsage($)),
    })
  })
}
