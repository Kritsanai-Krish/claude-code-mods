import type { EngineInterface, Register } from 'claude-code'
import { buildAwakePlan, classifyPlatform, parseActiveLayers } from './plans'
import type { AwakePlan, Platform } from './plans'

const COMMAND_NAME = 'keep-awake'
const NO_LAYER_TOAST_MS = 8000

// What the keeper is doing. These live in the module on purpose: a reload of
// the mod kills its children and runs session.start again, which starts over.
let platform: Platform | undefined
let isEnabled = true
/** Layers keeping the screen on; undefined while starting, [] when none could. */
let activeLayers: string[] | undefined
let stopRunning: (() => void) | undefined
/** Bumped on every start and stop, so a start that finishes late can tell it was replaced. */
let runGeneration = 0

/** Reads which operating system the session runs on. */
async function detectPlatform($: EngineInterface): Promise<Platform> {
  const windowsOs = await $.env.get('OS')
  const wslDistro = await $.env.get('WSL_DISTRO_NAME')
  if (windowsOs === 'Windows_NT') {
    return classifyPlatform(windowsOs, wslDistro, undefined)
  }

  let unameOutput: string | undefined
  try {
    const result = await $.process.run(['uname', '-s'])
    unameOutput = result.stdout
  } catch (error) {
    $.ui.log(`keep-awake: uname -s failed (${String(error)}), using the generic Unix keeper`, { to: 'debug' })
  }
  return classifyPlatform(windowsOs, wslDistro, unameOutput)
}

/** Records the layers in use and warns once when there are none. */
function reportLayers($: EngineInterface, layers: string[]): void {
  activeLayers = layers
  $.ui.log(`keep-awake: active layers on ${platform}: ${layers.join(', ') || 'none'}`, { to: 'debug' })
  if (layers.length === 0) {
    void $.ui.toast(`keep-awake: found no way to keep the screen on here (${platform}). See /keep-awake.`, { timeoutMs: NO_LAYER_TOAST_MS })
  }
}

/**
 * Runs one long-lived keeper child, trying each candidate argv until one
 * starts. The child lives exactly as long as this loop: stopRunning ends the
 * stream, which kills it.
 */
async function runKeeper($: EngineInterface, candidates: string[][], generation: number): Promise<void> {
  for (const argv of candidates) {
    if (generation !== runGeneration) {
      return
    }
    const child = $.process.spawn({ argv })
    let isStoppedByUs = false
    stopRunning = () => {
      isStoppedByUs = true
      void child.return(undefined as never)
    }

    let firstLineOutput = ''
    try {
      for await (const chunk of child) {
        if (chunk.stream !== 'stdout' || activeLayers !== undefined) {
          continue
        }
        firstLineOutput += chunk.text
        const layers = parseActiveLayers(firstLineOutput)
        if (layers !== undefined && generation === runGeneration) {
          reportLayers($, layers)
        }
      }
    } catch (error) {
      if (isStoppedByUs) {
        return
      }
      $.ui.log(`keep-awake: could not start ${argv[0]}: ${String(error)}`, { to: 'debug' })
      continue
    }

    // A keeper that already said `active: none` has been reported; don't warn twice.
    const wasAlreadyReportedAsNone = activeLayers?.length === 0
    if (!isStoppedByUs && generation === runGeneration && !wasAlreadyReportedAsNone) {
      $.ui.log(`keep-awake: ${argv[0]} exited on its own`, { to: 'debug' })
      reportLayers($, [])
    }
    return
  }

  if (generation === runGeneration) {
    reportLayers($, [])
  }
}

/** Runs the first candidate that succeeds once; returns it, or undefined if none did. */
async function findWorkingCommand($: EngineInterface, candidates: string[][]): Promise<string[] | undefined> {
  for (const argv of candidates) {
    try {
      const result = await $.process.run(argv)
      if (result.exitCode === 0) {
        return argv
      }
      $.ui.log(`keep-awake: ${argv[0]} exited ${result.exitCode}: ${result.stderr.trim()}`, { to: 'debug' })
    } catch (error) {
      $.ui.log(`keep-awake: could not run ${argv[0]}: ${String(error)}`, { to: 'debug' })
    }
  }
  return undefined
}

/** Resets the idle timer on a timer, for platforms with no long-lived keeper. */
async function runIdleReset($: EngineInterface, plan: Extract<AwakePlan, { kind: 'idle-reset' }>, generation: number): Promise<void> {
  const argv = await findWorkingCommand($, plan.candidates)
  if (generation !== runGeneration) {
    return
  }
  if (argv === undefined) {
    reportLayers($, [])
    return
  }

  const timer = $.clock.every(plan.intervalMs, () => {
    $.process.run(argv).catch(error => {
      $.ui.log(`keep-awake: idle reset failed: ${String(error)}`, { to: 'debug' })
    })
  })
  stopRunning = () => timer.cancel()
  reportLayers($, plan.layers)
}

function stopKeepingAwake(): void {
  runGeneration++
  stopRunning?.()
  stopRunning = undefined
  activeLayers = undefined
}

function startKeepingAwake($: EngineInterface): void {
  stopKeepingAwake()
  if (platform === undefined) {
    return
  }
  const generation = runGeneration
  const plan = buildAwakePlan(platform)
  const run = plan.kind === 'keeper'
    ? runKeeper($, plan.candidates, generation)
    : runIdleReset($, plan, generation)
  run.catch(error => {
    $.ui.log(`keep-awake: keeper failed: ${String(error)}`, { to: 'debug' })
  })
}

function describeState(): string {
  if (!isEnabled) {
    return 'Off for this session: the screen may sleep as usual. `/keep-awake on` turns it back on.'
  }
  if (activeLayers === undefined) {
    return 'Starting…'
  }
  if (activeLayers.length === 0) {
    return `On, but no way to keep the screen on was found on this system (${platform}). See the keep-awake README for what each system needs.`
  }
  return `On: the screen stays awake while Claude Code is open (${platform}: ${activeLayers.join(', ')}).`
}

/** Answers `/keep-awake [on|off|status]`; with no argument it toggles. */
function runCommand($: EngineInterface, args: string): string {
  const action = args.trim().toLowerCase()
  if (action === 'status') {
    return describeState()
  }

  const wantsOn = action === '' ? !isEnabled : action === 'on'
  if (action !== '' && action !== 'on' && action !== 'off') {
    return `Unknown option "${args.trim()}". Use /keep-awake, /keep-awake on, /keep-awake off or /keep-awake status.`
  }

  isEnabled = wantsOn
  if (isEnabled) {
    startKeepingAwake($)
    return 'On: the screen stays awake while Claude Code is open.'
  }
  stopKeepingAwake()
  return describeState()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND_NAME,
      description: 'Keep the screen awake while Claude Code is open (toggle, or on / off / status)',
      argumentHint: '[on|off|status]',
    })
    platform = await detectPlatform($)
    if (isEnabled) {
      startKeepingAwake($)
    }
    return started
  })

  on('command.run', { command: COMMAND_NAME }, async ($, e) => {
    try {
      return { text: runCommand($, e.args) }
    } catch (error) {
      return { text: `keep-awake failed: ${String(error)}` }
    }
  })
}
