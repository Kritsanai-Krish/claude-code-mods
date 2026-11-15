import { expect, test } from 'claude-code/testing'
import { buildAwakePlan, classifyPlatform, parseActiveLayers } from './plans'
import { encodePowerShellCommand } from './windows-script'

test('the platform comes from OS, WSL_DISTRO_NAME and uname', async () => {
  expect(classifyPlatform('Windows_NT', undefined, undefined)).toBe('windows')
  expect(classifyPlatform(undefined, 'Ubuntu', 'Linux\n')).toBe('wsl')
  expect(classifyPlatform(undefined, undefined, 'Darwin\n')).toBe('macos')
  expect(classifyPlatform(undefined, undefined, 'Linux\n')).toBe('unix')
  expect(classifyPlatform(undefined, undefined, 'FreeBSD\n')).toBe('unix')
  expect(classifyPlatform(undefined, '', 'Linux\n')).toBe('unix')
  expect(classifyPlatform(undefined, undefined, undefined)).toBe('unix')
})

test('PowerShell scripts are base64 of their UTF-16LE bytes', async () => {
  // Expected values from Python: base64.b64encode(text.encode('utf-16-le')).
  expect(encodePowerShellCommand('')).toBe('')
  expect(encodePowerShellCommand('a')).toBe('YQA=')
  expect(encodePowerShellCommand('ab')).toBe('YQBiAA==')
  expect(encodePowerShellCommand('abc')).toBe('YQBiAGMA')
  expect(encodePowerShellCommand("Write-Output 'ok'")).toBe('VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAG8AawAnAA==')
  expect(encodePowerShellCommand('ก')).toBe('AQ4=')
})

test('each platform gets a plan', async () => {
  const windows = buildAwakePlan('windows')
  expect(windows.kind).toBe('keeper')
  expect(windows.candidates[0]![0]).toBe('powershell.exe')
  expect(windows.candidates[0]).toContain('-EncodedCommand')

  const wsl = buildAwakePlan('wsl')
  expect(wsl.kind).toBe('idle-reset')

  const macos = buildAwakePlan('macos')
  expect(macos.candidates[0]![2]).toContain('caffeinate -d -i -w "$PPID"')

  const unix = buildAwakePlan('unix')
  expect(unix.candidates[0]!.slice(0, 2)).toEqual(['/bin/sh', '-c'])
  expect(unix.candidates[0]![3]).toBe('keep-awake')
})

test('the active line lists the layers, and none is an empty list', async () => {
  expect(parseActiveLayers('')).toBe(undefined)
  expect(parseActiveLayers('acti')).toBe(undefined)
  expect(parseActiveLayers('active: gnome-session logind\n')).toEqual(['gnome-session', 'logind'])
  expect(parseActiveLayers('noise\nactive: caffeinate\n')).toEqual(['caffeinate'])
  expect(parseActiveLayers('active: none\n')).toEqual([])
})
