import type { Elements } from 'claude-code'
import type { ContextView, PanelTab, PlanUsage, SessionActivity, UsageSnapshot } from '../types'
import { cacheHitPercent } from './activity'
import { formatCost, formatModelName, formatTokenCount, iconsFor } from './format'
import type { IconSet, Segment } from './format'
import { describePace, mergeLimits } from './limits'
import type { LimitView } from './limits'
import {
  EFFORT_LEVELS, MODEL_CHOICES, choiceName, describeReset, formatAge, formatDuration, formatShare, iconForLimit,
  isCurrentModel, orderCategories, squareGlyph, wideMeterSegments,
} from './panel-format'

/** The elements the panel draws with; every surface's table has these three. */
export type PanelElements = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the panel shows. */
export type PanelData = {
  tab: PanelTab
  snapshot: UsageSnapshot | null
  planUsage: PlanUsage | null
  activity: SessionActivity
  contextView: ContextView | null
  isContextLoading: boolean
  isPlanUsageLoading: boolean
  iconStyle: 'nerd' | 'unicode'
  bodyColumns: number
  nowMilliseconds: number
}

/** What the panel's buttons do. */
export type PanelActions = {
  selectTab: (tab: PanelTab) => void
  chooseModel: (alias: string) => void
  chooseEffort: (level: string) => void
  refreshContext: () => void
  refreshUsage: () => void
}

const MAX_METER_CELLS = 40
const PANEL_PADDING_CELLS = 2
const CATEGORY_NAME_CELLS = 26
const ITEM_LABEL_CELLS = 18
// `/usage` prints a 24-hour and a 7-day block that mostly repeat each other;
// the panel has room for the recent one's top lines.
const MAX_CONTRIBUTOR_BLOCKS = 1
const MAX_CONTRIBUTOR_LINES = 3

/** Cuts a line to the panel's width so it never wraps onto a second row. */
function truncate(line: string, width: number): string {
  const characters = [...line]
  return characters.length <= width ? line : `${characters.slice(0, width - 1).join('')}…`
}

/** Draws the whole popup: tab bar, a rule, the open tab, and a key hint line. */
export function drawPanel(ui: PanelElements, data: PanelData, actions: PanelActions) {
  const { Box, Text } = ui
  const ruleWidth = Math.max(10, data.bodyColumns - PANEL_PADDING_CELLS)
  const icons = iconsFor(data.iconStyle)
  return (
    <Box flexDirection="column" paddingX={1}>
      {drawTabBar(ui, data.tab, icons, actions)}
      <Text color="subtle">{'─'.repeat(ruleWidth)}</Text>
      <Box flexDirection="column" paddingY={1}>
        {drawTabBody(ui, data, icons, actions, ruleWidth)}
      </Box>
      <Text color="subtle">{'─'.repeat(ruleWidth)}</Text>
      <Text dimColor>m · c · u  switch tab     esc  close</Text>
    </Box>
  )
}

function drawTabBody(ui: PanelElements, data: PanelData, icons: IconSet, actions: PanelActions, width: number) {
  if (data.tab === 'model') {
    return drawModelTab(ui, data, icons, actions)
  }
  if (data.tab === 'context') {
    return drawContextTab(ui, data, icons, actions, width)
  }
  return drawUsageTab(ui, data, icons, actions, width)
}

function drawTabBar(ui: PanelElements, selectedTab: PanelTab, icons: IconSet, actions: PanelActions) {
  const { Box, Text, Button } = ui
  const tabs: readonly { tab: PanelTab; hotkey: string; icon: string; label: string }[] = [
    { tab: 'model', hotkey: 'm', icon: icons.model, label: 'Model' },
    { tab: 'context', hotkey: 'c', icon: icons.context, label: 'Context' },
    { tab: 'usage', hotkey: 'u', icon: icons.usage, label: 'Usage' },
  ]
  // No close button here: the pane's frame already draws one (✕), and Esc closes it.
  return (
    <Box flexDirection="row" gap={3}>
      {tabs.map(entry => {
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

function drawModelTab(ui: PanelElements, data: PanelData, icons: IconSet, actions: PanelActions) {
  const { Box, Text, Button } = ui
  const currentModelId = data.snapshot?.model ?? ''
  const currentEffort = data.snapshot?.effort
  const answeringModel = data.snapshot?.answeringModel
  const hasFallbackAnswered = answeringModel !== undefined && formatModelName(answeringModel) !== formatModelName(currentModelId)
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Switch model</Text>
      <Box flexDirection="column">
        {MODEL_CHOICES.map((choice, index) => {
          const isCurrent = isCurrentModel(choice, currentModelId)
          return (
            <Button key={`model-${choice.alias}`} plain hotkey={String(index + 1)} onPress={() => actions.chooseModel(choice.alias)}>
              <Text color={choice.color} bold={isCurrent}>{`${icons.model} ${choiceName(choice).padEnd(12)}`}</Text>
              <Text dimColor>{choice.modelId.padEnd(20)}</Text>
              <Text color="success">{isCurrent ? ' ● current' : ''}</Text>
            </Button>
          )
        })}
      </Box>
      {hasFallbackAnswered && (
        <Text color="warning">{`The last reply was answered by ${formatModelName(answeringModel)} (a fallback).`}</Text>
      )}
      <Box flexDirection="column">
        <Text bold>Effort</Text>
        <Box flexDirection="row" gap={2}>
          {EFFORT_LEVELS.map(level => {
            const isCurrent = level === currentEffort
            return (
              <Button key={`effort-${level}`} plain onPress={() => actions.chooseEffort(level)}>
                <Text color={isCurrent ? 'claude' : undefined} bold={isCurrent} underline={isCurrent} dimColor={!isCurrent}>
                  {level}
                </Text>
              </Button>
            )
          })}
        </Box>
        {currentEffort === undefined && <Text dimColor>Not known yet: it shows with the next reply.</Text>}
      </Box>
      <Text dimColor>
        Press 1–4 or click. The pick also becomes the default for new sessions. While Claude is replying, the switch
        waits for the reply to end.
      </Text>
    </Box>
  )
}

function drawContextTab(ui: PanelElements, data: PanelData, icons: IconSet, actions: PanelActions, width: number) {
  const { Box, Text, Button } = ui
  const view = data.contextView
  const refreshButton = (
    <Button key="refresh" plain hotkey="r" onPress={actions.refreshContext}>
      <Text color="suggestion">{data.isContextLoading ? `${icons.refresh} counting…` : `${icons.refresh} recount`}</Text>
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
  const countKind = view.isExact ? 'exact' : 'estimate'
  const age = formatAge(data.nowMilliseconds - view.countedAt)
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color="suggestion">{`${icons.context} `}</Text>
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
            <Text>{category.name.padEnd(CATEGORY_NAME_CELLS)}</Text>
            <Text bold>{formatTokenCount(category.tokens).padStart(6)}</Text>
            <Text dimColor>{formatShare(category.tokens, view.maxTokens).padStart(8)}</Text>
            <Text dimColor>{category.kind === 'deferred' ? '  (loaded on demand)' : ''}</Text>
          </Text>
        ))}
      </Box>
      {view.largestItems.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Largest items</Text>
          {view.largestItems.map(item => (
            <Text>
              <Text>{item.label.slice(0, ITEM_LABEL_CELLS).padEnd(ITEM_LABEL_CELLS)}</Text>
              <Text bold>{formatTokenCount(item.tokens).padStart(6)}</Text>
              <Text dimColor>{truncate(`  ${item.detail}`, Math.max(1, width - ITEM_LABEL_CELLS - 6))}</Text>
            </Text>
          ))}
        </Box>
      )}
      <Box flexDirection="column">
        <Text dimColor>{describeAutoCompact(view)}</Text>
        <Text dimColor>{`Counted ${age} (${countKind}).`}</Text>
      </Box>
    </Box>
  )
}

/** Says when auto-compaction runs and how much room is left before it. */
function describeAutoCompact(view: ContextView): string {
  if (view.autoCompactThreshold === undefined) {
    return 'Auto-compact is off'
  }
  const tokensLeft = Math.max(0, view.autoCompactThreshold - view.totalTokens)
  return `Auto-compact at ${formatTokenCount(view.autoCompactThreshold)} tokens (${formatTokenCount(tokensLeft)} to go)`
}

/** One limit: title and percent on a line, a long meter, then when it resets and where the pace leads. */
function drawLimitBlock(ui: PanelElements, limit: LimitView, icons: IconSet, nowMilliseconds: number, meterCells: number) {
  const { Box, Text } = ui
  const { icon, color } = iconForLimit(limit.kind, icons)
  const resetLine = describeReset(limit, nowMilliseconds)
  const pace = describePace(limit, nowMilliseconds)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width={meterCells}>
        <Text>
          <Text color={color}>{`${icon} `}</Text>
          <Text bold>{limit.title}</Text>
        </Text>
        <Text bold>{`${Math.round(limit.percentUsed)}%`}</Text>
      </Box>
      <Text>{drawSegments(ui, wideMeterSegments(limit.percentUsed, meterCells))}</Text>
      <Text dimColor>{resetLine === '' ? ' ' : resetLine}</Text>
      {pace !== undefined && <Text color={pace.isRunningOut ? 'warning' : undefined} dimColor={!pace.isRunningOut}>{pace.text}</Text>}
    </Box>
  )
}

/** The session's cost, age and turn counts on one line. */
function describeSession(snapshot: UsageSnapshot, activity: SessionActivity, nowMilliseconds: number): string {
  const parts = [formatDuration(nowMilliseconds - snapshot.startedAt)]
  if (snapshot.costUsd !== undefined) {
    parts.unshift(`$${formatCost(snapshot.costUsd)}`)
  }
  if (activity.turnCount > 0) {
    parts.push(`${activity.turnCount} ${activity.turnCount === 1 ? 'turn' : 'turns'}`)
  }
  if (activity.subagentRunCount > 0) {
    parts.push(`${activity.subagentRunCount} subagent ${activity.subagentRunCount === 1 ? 'run' : 'runs'}`)
  }
  return parts.join('  ·  ')
}

/** The session's token totals on one line, or undefined before the first turn has ended. */
function describeTokens(activity: SessionActivity): string | undefined {
  if (activity.turnCount + activity.subagentRunCount === 0) {
    return undefined
  }
  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = activity.totals
  const hitPercent = cacheHitPercent(activity.totals)
  const cachedShare = hitPercent === undefined ? '' : ` (${hitPercent}%)`
  const parts = [
    `in ${formatTokenCount(inputTokens + cacheWriteTokens)}`,
    `cached ${formatTokenCount(cacheReadTokens)}${cachedShare}`,
    `out ${formatTokenCount(outputTokens)}`,
  ]
  return parts.join('  ·  ')
}

/** The last turn's length and output on one line, or undefined before one has ended. */
function describeLastTurn(activity: SessionActivity): string | undefined {
  const turn = activity.lastTurn
  if (turn === undefined) {
    return undefined
  }
  const parts = [formatDuration(turn.durationMilliseconds), `out ${formatTokenCount(turn.outputTokens)}`]
  if (turn.model !== undefined) {
    parts.push(formatModelName(turn.model))
  }
  if (turn.endReason !== 'answer') {
    parts.push(turn.endReason)
  }
  return parts.join('  ·  ')
}

function drawUsageTab(ui: PanelElements, data: PanelData, icons: IconSet, actions: PanelActions, width: number) {
  const { Box, Text, Button } = ui
  const snapshot = data.snapshot
  if (snapshot === null) {
    return <Text dimColor>No reading yet: it arrives with Claude's first reply.</Text>
  }
  const meterCells = Math.min(MAX_METER_CELLS, width)
  const limits = mergeLimits(snapshot, data.planUsage, data.nowMilliseconds)
  const usageAge = data.planUsage === null ? undefined : formatAge(data.nowMilliseconds - data.planUsage.fetchedAt)
  const tokensLine = describeTokens(data.activity)
  const lastTurnLine = describeLastTurn(data.activity)
  const contributorBlocks = data.planUsage?.contributorBlocks ?? []
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" width={meterCells}>
        <Text bold>Plan limits</Text>
        <Button key="refresh-usage" plain hotkey="r" onPress={actions.refreshUsage}>
          <Text color="suggestion">{data.isPlanUsageLoading ? `${icons.refresh} checking…` : `${icons.refresh} refresh`}</Text>
        </Button>
      </Box>
      {limits.length === 0
        ? <Text dimColor>No plan limits reported (API key, or no reply yet).</Text>
        : limits.map(limit => drawLimitBlock(ui, limit, icons, data.nowMilliseconds, meterCells))}
      {usageAge !== undefined && <Text dimColor>{`Checked with /usage ${usageAge}.`}</Text>}
      <Box flexDirection="column">
        <Text>
          <Text color="success">{`${icons.cost} `}</Text>
          <Text bold>This session  </Text>
          <Text dimColor>{describeSession(snapshot, data.activity, data.nowMilliseconds)}</Text>
        </Text>
        {tokensLine !== undefined && <Text dimColor>{`  tokens     ${tokensLine}`}</Text>}
        {lastTurnLine !== undefined && <Text dimColor>{`  last turn  ${lastTurnLine}`}</Text>}
      </Box>
      {contributorBlocks.length > 0 && (
        <Box flexDirection="column">
          <Text bold>What used your limits</Text>
          {contributorBlocks.slice(0, MAX_CONTRIBUTOR_BLOCKS).map(block => (
            <Box flexDirection="column">
              <Text dimColor>{truncate(block.title, width)}</Text>
              {block.lines.slice(0, MAX_CONTRIBUTOR_LINES).map(line => <Text>{truncate(`  ${line}`, width)}</Text>)}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
