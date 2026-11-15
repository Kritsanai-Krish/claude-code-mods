import type { Elements } from 'claude-code'
import type { ContextView, PanelTab, PlanUsage, UsageSnapshot } from '../types'
import { ICON_CONTEXT, ICON_COST, ICON_MODEL, formatTimeUntil, formatTokenCount } from './format'
import type { Segment } from './format'
import {
  MODEL_CHOICES, choiceName, formatDuration, formatShare, isCurrentModel, orderCategories,
  squareGlyph, titleForLimit, titleForModelWindow, wideMeterSegments,
} from './panel-format'
import type { LimitTitle } from './panel-format'

/** The elements the panel draws with; every surface's table has these three. */
export type PanelElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the panel shows. */
export type PanelData = {
  tab: PanelTab
  snapshot: UsageSnapshot | null
  contextView: ContextView | null
  isContextLoading: boolean
  planUsage: PlanUsage | null
  isPlanUsageLoading: boolean
  bodyColumns: number
  nowMilliseconds: number
}

/** What the panel's buttons do. */
export type PanelActions = {
  selectTab: (tab: PanelTab) => void
  chooseModel: (alias: string) => void
  refreshContext: () => void
  refreshUsage: () => void
}

const ICON_USAGE = '\u{F01DE}' // donut chart
const ICON_REFRESH = '\u{F0450}' // refresh
const MAX_METER_CELLS = 40
const PANEL_PADDING_CELLS = 2

const TABS: readonly { tab: PanelTab; hotkey: string; icon: string; label: string }[] = [
  { tab: 'model', hotkey: 'm', icon: ICON_MODEL, label: 'Model' },
  { tab: 'context', hotkey: 'c', icon: ICON_CONTEXT, label: 'Context' },
  { tab: 'usage', hotkey: 'u', icon: ICON_USAGE, label: 'Usage' },
]

/** Draws the whole popup: tab bar, a rule, the open tab, and a key hint line. */
export function drawPanel(ui: PanelElements, data: PanelData, actions: PanelActions) {
  const { Box, Text } = ui
  const ruleWidth = Math.max(10, data.bodyColumns - PANEL_PADDING_CELLS)
  return (
    <Box flexDirection="column" paddingX={1}>
      {drawTabBar(ui, data.tab, actions)}
      <Text color="subtle">{'─'.repeat(ruleWidth)}</Text>
      <Box flexDirection="column" paddingY={1}>
        {drawTabBody(ui, data, actions, ruleWidth)}
      </Box>
      <Text color="subtle">{'─'.repeat(ruleWidth)}</Text>
      <Text dimColor>esc  close</Text>
    </Box>
  )
}

function drawTabBody(ui: PanelElements, data: PanelData, actions: PanelActions, width: number) {
  if (data.tab === 'model') {
    return drawModelTab(ui, data, actions)
  }
  if (data.tab === 'context') {
    return drawContextTab(ui, data, actions, width)
  }
  return drawUsageTab(ui, data, actions, width)
}

function drawTabBar(ui: PanelElements, selectedTab: PanelTab, actions: PanelActions) {
  const { Box, Text, Button } = ui
  // No close button here: the pane's frame already draws one (✕), and Esc closes it.
  return (
    <Box flexDirection="row" gap={3}>
        {TABS.map(entry => {
          const isSelected = entry.tab === selectedTab
          return (
            <Button key={`tab-${entry.tab}`} plain hotkey={entry.hotkey} onPress={() => actions.selectTab(entry.tab)}>
              <Text color={isSelected ? 'claude' : undefined} bold={isSelected} dimColor={!isSelected} underline={isSelected}>
                {`${entry.icon} ${entry.label}`}
              </Text>
            </Button>
          )
        })}
    </Box>
  )
}

function drawSegments(ui: PanelElements, segments: Segment[]) {
  const { Text } = ui
  return segments.map(segment => (
    <Text color={segment.color} bold={segment.isBold} dimColor={segment.isDim}>
      {segment.text}
    </Text>
  ))
}

function drawModelTab(ui: PanelElements, data: PanelData, actions: PanelActions) {
  const { Box, Text, Button } = ui
  const currentModelId = data.snapshot?.model ?? ''
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Switch model</Text>
      <Box flexDirection="column">
        {MODEL_CHOICES.map((choice, index) => {
          const isCurrent = isCurrentModel(choice, currentModelId)
          return (
            <Button key={`model-${choice.alias}`} plain hotkey={String(index + 1)} onPress={() => actions.chooseModel(choice.alias)}>
              <Text color={choice.color} bold={isCurrent}>{`${ICON_MODEL} ${choiceName(choice).padEnd(12)}`}</Text>
              <Text dimColor>{choice.modelId.padEnd(20)}</Text>
              <Text color="success">{isCurrent ? ' ● current' : ''}</Text>
            </Button>
          )
        })}
      </Box>
      <Text dimColor>Press 1–4 or click. While Claude is replying, the switch waits for the reply to end.</Text>
    </Box>
  )
}

function drawContextTab(ui: PanelElements, data: PanelData, actions: PanelActions, width: number) {
  const { Box, Text, Button } = ui
  const view = data.contextView
  const refreshButton = (
    <Button key="refresh" plain hotkey="r" onPress={actions.refreshContext}>
      <Text color="suggestion">{data.isContextLoading ? `${ICON_REFRESH} counting…` : `${ICON_REFRESH} refresh`}</Text>
    </Button>
  )
  if (view === null) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>{data.isContextLoading ? 'Counting the context window…' : 'No count yet.'}</Text>
        {refreshButton}
      </Box>
    )
  }
  const squareWidth = (view.gridRows[0]?.length ?? 0) * 2 <= width ? 2 : 1
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color="suggestion">{`${ICON_CONTEXT} `}</Text>
          <Text bold>{`${formatTokenCount(view.totalTokens)} / ${formatTokenCount(view.maxTokens)}`}</Text>
          <Text dimColor>{`  tokens · ${view.percentage}%`}</Text>
        </Text>
        {refreshButton}
      </Box>
      <Box flexDirection="column">
        {view.gridRows.map(row => (
          <Text>
            {row.map(square => (
              <Text color={square.isFilled ? square.color : 'subtle'}>
                {squareGlyph(square).padEnd(squareWidth)}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {orderCategories(view.categories).map(category => (
          <Text dimColor={category.kind === 'deferred'}>
            <Text color={category.color}>■ </Text>
            <Text>{category.name.padEnd(26)}</Text>
            <Text bold>{formatTokenCount(category.tokens).padStart(6)}</Text>
            <Text dimColor>{formatShare(category.tokens, view.maxTokens).padStart(8)}</Text>
            <Text dimColor>{category.kind === 'deferred' ? '  (loaded on demand)' : ''}</Text>
          </Text>
        ))}
      </Box>
      <Text dimColor>
        {view.autoCompactThreshold === undefined
          ? 'Auto-compact is off'
          : `Auto-compact at ${formatTokenCount(view.autoCompactThreshold)} tokens`}
      </Text>
    </Box>
  )
}

/** One limit: title and percent on a line, a long meter, then when it resets. */
function drawLimitBlock(ui: PanelElements, title: LimitTitle, percentUsed: number, resetLine: string, meterCells: number) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={meterCells}>
        <Text>
          <Text color={title.iconColor}>{`${title.icon} `}</Text>
          <Text bold>{title.title}</Text>
        </Text>
        <Text bold>{`${Math.round(percentUsed)}%`}</Text>
      </Box>
      <Text>{drawSegments(ui, wideMeterSegments(percentUsed, meterCells))}</Text>
      <Text dimColor>{resetLine === '' ? ' ' : resetLine}</Text>
    </Box>
  )
}

function drawUsageTab(ui: PanelElements, data: PanelData, actions: PanelActions, width: number) {
  const { Box, Text, Button } = ui
  const snapshot = data.snapshot
  if (snapshot === null) {
    return <Text dimColor>No reading yet: it arrives with Claude's first reply.</Text>
  }
  const meterCells = Math.min(MAX_METER_CELLS, width)
  const limitBlocks = []
  for (const limit of snapshot.limits) {
    const title = titleForLimit(limit)
    if (title === undefined) {
      continue
    }
    const resetText = formatTimeUntil(limit.resetsAt, data.nowMilliseconds)
    limitBlocks.push(drawLimitBlock(ui, title, limit.percentUsed, resetText === '' ? '' : `resets in ${resetText}`, meterCells))
  }
  // Per-model weekly windows (Fable's) come from `claude -p /usage`, not the headers.
  const modelWindows = data.planUsage?.modelWindows ?? []
  for (const window of modelWindows) {
    const resetLine = window.resetText === '' ? '' : `resets ${window.resetText}`
    limitBlocks.push(drawLimitBlock(ui, titleForModelWindow(window.name), window.percentUsed, resetLine, meterCells))
  }
  const sessionParts = [
    snapshot.costUsd === undefined ? undefined : `$${snapshot.costUsd.toFixed(2)}`,
    formatDuration(data.nowMilliseconds - snapshot.startedAt),
    snapshot.contextTokens === undefined ? undefined : `${formatTokenCount(snapshot.contextTokens)} context`,
  ].filter(part => part !== undefined)
  const contributors = data.planUsage?.contributors ?? []
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" width={meterCells}>
        <Text bold>Plan limits</Text>
        <Button key="refresh-usage" plain hotkey="r" onPress={actions.refreshUsage}>
          <Text color="suggestion">{data.isPlanUsageLoading ? `${ICON_REFRESH} checking…` : `${ICON_REFRESH} refresh`}</Text>
        </Button>
      </Box>
      {limitBlocks.length === 0 ? <Text dimColor>No plan limits reported (API key, or no reply yet).</Text> : limitBlocks}
      <Text>
        <Text color="success">{`${ICON_COST} `}</Text>
        <Text bold>This session  </Text>
        <Text dimColor>{sessionParts.join('  ·  ')}</Text>
      </Text>
      {contributors.length > 0 && (
        <Box flexDirection="column">
          <Text bold>What used your limits</Text>
          <Text dimColor>{contributors[0]}</Text>
          {contributors.slice(1).map(line => <Text>{line}</Text>)}
        </Box>
      )}
    </Box>
  )
}
