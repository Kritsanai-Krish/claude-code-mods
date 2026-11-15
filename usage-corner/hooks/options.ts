/** How the mod is set up, from its rows in `/config` (plugin.json `userConfig`). */
export type Settings = {
  /** `nerd`: Nerd Font icons; `unicode`: plain symbols every font has. */
  iconStyle: 'nerd' | 'unicode'
  areAlertsEnabled: boolean
  isCostShown: boolean
  /** How often to re-read `/usage` while the session sits idle; undefined turns that off. */
  usageRefreshMilliseconds: number | undefined
}

const MILLISECONDS_PER_MINUTE = 60_000
const DEFAULT_USAGE_REFRESH_MINUTES = 3

export const DEFAULT_SETTINGS: Settings = {
  iconStyle: 'nerd',
  areAlertsEnabled: true,
  isCostShown: true,
  usageRefreshMilliseconds: DEFAULT_USAGE_REFRESH_MINUTES * MILLISECONDS_PER_MINUTE,
}

/** Reads `off` or `<n> min`; anything else is the default. */
function readUsageRefresh(value: unknown): number | undefined {
  if (value === 'off') {
    return undefined
  }
  const match = typeof value === 'string' ? /^(\d+) min$/.exec(value) : null
  if (match === null) {
    return DEFAULT_SETTINGS.usageRefreshMilliseconds
  }
  return Number(match[1]) * MILLISECONDS_PER_MINUTE
}

/** Turns the raw option values into settings, falling back to the default for anything missing or malformed. */
export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  return {
    iconStyle: options.icons === 'unicode' ? 'unicode' : DEFAULT_SETTINGS.iconStyle,
    areAlertsEnabled: typeof options.alerts === 'boolean' ? options.alerts : DEFAULT_SETTINGS.areAlertsEnabled,
    isCostShown: typeof options.showCost === 'boolean' ? options.showCost : DEFAULT_SETTINGS.isCostShown,
    usageRefreshMilliseconds: readUsageRefresh(options.usageRefresh),
  }
}
