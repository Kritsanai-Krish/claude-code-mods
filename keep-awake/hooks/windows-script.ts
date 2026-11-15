// PowerShell for Windows. SetThreadExecutionState is the Windows API apps
// such as video players use to keep the display on; Windows PowerShell 5.1
// ships with every Windows that runs Claude Code, so nothing is installed.

const LOAD_POWER_API = `
Add-Type -Namespace KeepAwake -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'
`

// ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED (0x80000003): keep
// the display and the system on until this thread clears it or ends.
//
// The parent of this PowerShell is Claude Code. The loop re-asserts the state
// and exits once Claude Code is gone, and Windows drops the request when the
// process ends, so nothing outlives the session.
export const WINDOWS_KEEPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
${LOAD_POWER_API}
$keepAwakeFlags = [uint32]2147483651
$checkIntervalSeconds = 5
$claudeProcessId = (Get-CimInstance Win32_Process -Filter "ProcessId = $PID").ParentProcessId
[void][KeepAwake.Power]::SetThreadExecutionState($keepAwakeFlags)
Write-Output 'active: windows-execution-state'
while (Get-Process -Id $claudeProcessId -ErrorAction SilentlyContinue) {
  [void][KeepAwake.Power]::SetThreadExecutionState($keepAwakeFlags)
  Start-Sleep -Seconds $checkIntervalSeconds
}
`

// ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED without ES_CONTINUOUS (0x3): resets
// the display and sleep idle timers once and holds nothing. Used from WSL,
// where a Windows process cannot watch the Linux process that started it, so
// the mod calls this on a timer and simply stops calling when it ends.
export const WINDOWS_IDLE_RESET_SCRIPT = `
$ErrorActionPreference = 'Stop'
${LOAD_POWER_API}
[void][KeepAwake.Power]::SetThreadExecutionState([uint32]3)
`

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Encodes a script for `powershell -EncodedCommand`: base64 of its UTF-16LE
 * bytes. Passing the script this way avoids Windows command-line quoting,
 * which mangles the double quotes the scripts above contain.
 */
export function encodePowerShellCommand(script: string): string {
  const bytes: number[] = []
  for (let index = 0; index < script.length; index++) {
    const codeUnit = script.charCodeAt(index)
    bytes.push(codeUnit & 0xff, codeUnit >> 8)
  }

  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    const group = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
    encoded += BASE64_ALPHABET[(group >> 18) & 63]
    encoded += BASE64_ALPHABET[(group >> 12) & 63]
    encoded += second === undefined ? '=' : BASE64_ALPHABET[(group >> 6) & 63]
    encoded += third === undefined ? '=' : BASE64_ALPHABET[group & 63]
  }
  return encoded
}

/** The argv that runs `script` in Windows PowerShell with no profile or prompts. */
export function buildPowerShellArgv(executable: string, script: string): string[] {
  return [
    executable,
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', encodePowerShellCommand(script),
  ]
}
