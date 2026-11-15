import { POSIX_KEEPER_SCRIPT, PYTHON_DBUS_HOLDER } from './posix-script'
import { WINDOWS_IDLE_RESET_SCRIPT, WINDOWS_KEEPER_SCRIPT, buildPowerShellArgv } from './windows-script'

/** The operating system families the mod knows how to keep awake. */
export type Platform = 'windows' | 'wsl' | 'macos' | 'unix'

/**
 * How to keep one platform awake.
 *
 * `keeper`: one long-running child for the whole session. Each argv in
 * `candidates` is tried in order until one starts; the child writes
 * `active: <layers>` on its first line.
 *
 * `idle-reset`: a short command run every `intervalMs`, for where no child can
 * tell when Claude Code ends (WSL); `layers` names what it does.
 */
export type AwakePlan =
  | { kind: 'keeper'; candidates: string[][] }
  | { kind: 'idle-reset'; candidates: string[][]; intervalMs: number; layers: string[] }

// Windows' shortest display timeout is one minute; resetting twice a minute
// keeps a margin when a reset is slow to start.
const WSL_RESET_INTERVAL_MS = 30_000

/**
 * Names the platform from what the host reports: Windows sets `OS`, WSL sets
 * `WSL_DISTRO_NAME`, and `uname -s` names the rest.
 */
export function classifyPlatform(windowsOs: string | undefined, wslDistro: string | undefined, unameOutput: string | undefined): Platform {
  if (windowsOs === 'Windows_NT') {
    return 'windows'
  }
  if (wslDistro !== undefined && wslDistro !== '') {
    return 'wsl'
  }
  if (unameOutput?.trim() === 'Darwin') {
    return 'macos'
  }
  return 'unix'
}

/** Builds the commands that keep `platform` awake. */
export function buildAwakePlan(platform: Platform): AwakePlan {
  switch (platform) {
    case 'windows':
      return {
        kind: 'keeper',
        candidates: [
          buildPowerShellArgv('powershell.exe', WINDOWS_KEEPER_SCRIPT),
          buildPowerShellArgv('pwsh.exe', WINDOWS_KEEPER_SCRIPT),
        ],
      }
    case 'wsl':
      return {
        kind: 'idle-reset',
        candidates: [
          buildPowerShellArgv('powershell.exe', WINDOWS_IDLE_RESET_SCRIPT),
          buildPowerShellArgv('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', WINDOWS_IDLE_RESET_SCRIPT),
        ],
        intervalMs: WSL_RESET_INTERVAL_MS,
        layers: ['windows-idle-reset'],
      }
    case 'macos':
      // caffeinate ships with macOS: -d keeps the display on, -i stops idle
      // sleep, -w ends it with Claude Code ($PPID of this shell).
      return {
        kind: 'keeper',
        candidates: [['/bin/sh', '-c', 'echo "active: caffeinate"; exec caffeinate -d -i -w "$PPID"']],
      }
    case 'unix':
      return {
        kind: 'keeper',
        candidates: [['/bin/sh', '-c', POSIX_KEEPER_SCRIPT, 'keep-awake', PYTHON_DBUS_HOLDER]],
      }
  }
}

const ACTIVE_LINE = /^active:(.*)$/m

/**
 * Reads the layers a keeper reported from its output so far: `undefined`
 * until the line has arrived, `[]` when it found no way to keep awake.
 */
export function parseActiveLayers(output: string): string[] | undefined {
  const match = ACTIVE_LINE.exec(output)
  if (match === null) {
    return undefined
  }
  const layers = match[1]!.trim().split(/\s+/).filter(layer => layer !== '')
  return layers.filter(layer => layer !== 'none')
}
