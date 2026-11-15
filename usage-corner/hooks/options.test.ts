import { expect, test } from 'claude-code/testing'
import { DEFAULT_SETTINGS, readSettings } from './options'

test('missing or malformed options fall back to the defaults', async () => {
  expect(readSettings({})).toEqual(DEFAULT_SETTINGS)
  expect(readSettings({ icons: 'emoji', alerts: 'yes', showCost: 1, usageRefresh: 'hourly' })).toEqual(DEFAULT_SETTINGS)
})

test('valid options are applied', async () => {
  expect(readSettings({ icons: 'unicode', alerts: false, showCost: false, usageRefresh: 'off' })).toEqual({
    iconStyle: 'unicode', areAlertsEnabled: false, isCostShown: false, usageRefreshMilliseconds: undefined,
  })
  expect(readSettings({ usageRefresh: '10 min' }).usageRefreshMilliseconds).toBe(600_000)
})
