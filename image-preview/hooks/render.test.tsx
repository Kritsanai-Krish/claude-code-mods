import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, SessionAppendInput } from 'claude-code'

// A 1x1 PNG: written to the cache as it is, with no conversion.
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG_BYTES = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQE'
const CACHE = '/home/test/.cache/claude-image-preview'
const MESSAGE_UUID = 'f94e7fd5-072b-46af-a4a1-d64ed6c0cd51'
const ROW_ID = 'f94e7fd5-072b-46af-a4a1-000000000000'
const VIEWPORT = { columns: 100, rows: 40 }

/** The machine beneath the mod: a disk in memory and the commands run on it. */
type Machine = {
  files: Map<string, string>
  commands: string[][]
  /** Which ImageMagick commands exist; a missing one cannot start. */
  installed: Set<string>
}

function startMachine(on: On): Machine {
  const machine: Machine = { files: new Map(), commands: [], installed: new Set(['magick']) }
  mock.clock(on, { now: Date.parse('2026-11-15T12:00:00Z') })
  mock.env(on, { HOME: '/home/test' })
  on('fs.list', () => ({ value: [] }))
  on('fs.read', (_, e) => {
    const base64 = machine.files.get(e.path)
    if (base64 === undefined) {
      throw new Error(`no such file: ${e.path}`)
    }
    return { value: { base64 } }
  })
  on('process.run', (_, e) => {
    const [command = '', ...rest] = e.argv
    machine.commands.push([...e.argv])
    const done = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (command === 'sh') {
      // sh -c 'base64 -d > "$1"' sh <path>, the bytes on stdin
      machine.files.set(rest[3] ?? '', e.init?.stdin ?? '')
      return done()
    }
    if (command === 'magick' || command === 'convert') {
      if (!machine.installed.has(command)) {
        throw new Error(`cannot start ${command}`)
      }
      const output = rest.find(argument => argument.startsWith('PNG:'))?.slice('PNG:'.length) ?? ''
      machine.files.set(output, ONE_PIXEL_PNG)
      return done('640 480\n')
    }
    return done()
  })
  // The engine's own drawing of every row.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>the row</Text>
  })
  return machine
}

function imageBlock(mediaType: string, data: string) {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
}

/** Stores a row as the engine does when the conversation grows. */
async function append($: Engine, row: Pick<SessionAppendInput, 'door' | 'uuid'> & { content: unknown[]; agentId?: string }): Promise<void> {
  const session = $.session as unknown as { append: (input: unknown) => Promise<unknown> }
  await session.append({
    door: row.door,
    uuid: row.uuid,
    agentId: row.agentId,
    origin: { kind: 'composer' },
    message: { type: 'user', role: 'user', content: row.content },
  })
}

function toolRow(tool: string, output?: unknown) {
  return {
    plugin: 'image-preview', component: 'ToolUse', requestId: 'toolu_1', viewport: VIEWPORT,
    props: { tool_use_id: 'toolu_1', tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, output },
  } as const
}

function promptRow(requestId: string, text: string) {
  return {
    plugin: 'image-preview', component: 'UserMessage', requestId, viewport: VIEWPORT,
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
  } as const
}

test('a picture any tool returns is drawn under that tool\'s row', async ($, on) => {
  const machine = startMachine(on)
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID,
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/png', ONE_PIXEL_PNG)] }],
  })
  const ui = await $.ui.mount({ ...toolRow('mcp__browser__screenshot'), surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /the row/ }))?.text).toBe('the row')
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ png: ONE_PIXEL_PNG })
  expect([image?.props.columns, image?.props.rows]).toEqual([1, 1])
  expect(machine.files.get(`${CACHE}/tool_toolu_1-0.png`)).toBe(ONE_PIXEL_PNG)
  // A PNG needs no ImageMagick.
  expect(machine.commands.some(argv => argv[0] === 'magick')).toBe(false)
  await ui.unmount()
})

test('a JPEG goes through ImageMagick, told which decoder to use', async ($, on) => {
  const machine = startMachine(on)
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID,
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/jpeg', JPEG_BYTES)] }],
  })
  const ui = await $.ui.mount({ ...toolRow('Read'), surface: 'terminal' })
  expect((await ui.find({ type: 'Image' }))?.props.alt).toBe('[image 640×480]')
  const magick = machine.commands.find(argv => argv[0] === 'magick')
  expect(magick?.[1]).toBe(`jpeg:${CACHE}/tool_toolu_1-0.source[0]`)
  // The temporary copy of the JPEG is removed again.
  expect(machine.commands.some(argv => argv[0] === 'rm' && argv.includes(`${CACHE}/tool_toolu_1-0.source`))).toBe(true)
  await ui.unmount()
})

test('ImageMagick 6 (convert) is used when magick is not installed', async ($, on) => {
  const machine = startMachine(on)
  machine.installed = new Set(['convert'])
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID,
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/jpeg', JPEG_BYTES)] }],
  })
  const ui = await $.ui.mount({ ...toolRow('Read'), surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeTruthy()
  await ui.unmount()
})

test('without ImageMagick a JPEG row says what to install, and a PNG still shows', async ($, on) => {
  const machine = startMachine(on)
  machine.installed = new Set()
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID,
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/jpeg', JPEG_BYTES), imageBlock('image/png', ONE_PIXEL_PNG)] }],
  })
  const ui = await $.ui.mount({ ...toolRow('Read'), surface: 'terminal' })
  expect((await ui.findAll({ type: 'Image' })).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /install ImageMagick to preview JPEG, GIF and WebP/ })).toBeTruthy()
  await ui.unmount()
})

test('a resumed session, with no stored row to go by, still shows what Read holds', async ($, on) => {
  startMachine(on)
  const output = { type: 'image', file: { base64: ONE_PIXEL_PNG, type: 'image/png', originalSize: 70 } }
  const ui = await $.ui.mount({ ...toolRow('Read', output), surface: 'terminal' })
  expect((await ui.find({ type: 'Image' }))?.props.source).toEqual({ png: ONE_PIXEL_PNG })
  await ui.unmount()
})

test('a Read of text draws only the row', async ($, on) => {
  startMachine(on)
  const output = { type: 'text', file: { filePath: '/tmp/notes.md', content: 'hi' } }
  const ui = await $.ui.mount({ ...toolRow('Read', output), surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBe(undefined)
  await ui.unmount()
})

test('the pictures attached to a prompt are drawn side by side under it', async ($, on) => {
  startMachine(on)
  const text = '[Image #1] which is nicer? [Image #2]'
  await append($, {
    door: 'prompt', uuid: MESSAGE_UUID,
    content: [{ type: 'text', text }, imageBlock('image/png', ONE_PIXEL_PNG), imageBlock('image/png', ONE_PIXEL_PNG)],
  })
  for (const requestId of [ROW_ID, 'placeholder']) {
    const ui = await $.ui.mount({ ...promptRow(requestId, text), surface: 'terminal' })
    expect((await ui.findAll({ type: 'Image' })).length, requestId).toBe(2)
    await ui.unmount()
  }
})

test('the same words sent again without pictures show no pictures', async ($, on) => {
  startMachine(on)
  await append($, { door: 'prompt', uuid: MESSAGE_UUID, content: [{ type: 'text', text: 'hello' }, imageBlock('image/png', ONE_PIXEL_PNG)] })
  const otherRow = 'aaaaaaaa-072b-46af-a4a1-000000000000'
  const ui = await $.ui.mount({ ...promptRow(otherRow, 'hello'), surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBe(undefined)
  await ui.unmount()
})

test('a subagent\'s rows are not prepared: they are not drawn here', async ($, on) => {
  const machine = startMachine(on)
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID, agentId: 'agent-1',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/png', ONE_PIXEL_PNG)] }],
  })
  expect(machine.commands).toEqual([])
})

test('the caption shows the size and opens the picture in the desktop viewer', async ($, on) => {
  const machine = startMachine(on)
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID,
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/png', ONE_PIXEL_PNG)] }],
  })
  const ui = await $.ui.mount({ ...toolRow('Read'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /1×1 · open/ })).toBeTruthy()
  await ui.press({ key: 'open-tool-0' })
  expect(machine.commands.at(-1)).toEqual(['xdg-open', `${CACHE}/tool_toolu_1-0.png`])
  await ui.unmount()
})

test('captions can be turned off', { options: { captions: false } }, async ($, on) => {
  startMachine(on)
  await append($, {
    door: 'tool-result', uuid: MESSAGE_UUID,
    content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [imageBlock('image/png', ONE_PIXEL_PNG)] }],
  })
  const ui = await $.ui.mount({ ...toolRow('Read'), surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /open/ })).toBe(undefined)
  await ui.unmount()
})

test('other surfaces get the row without a picture', async ($, on) => {
  startMachine(on)
  const output = { type: 'image', file: { base64: ONE_PIXEL_PNG, type: 'image/png', originalSize: 70 } }
  const ui = await $.ui.mount({ ...toolRow('Read', output), surface: 'desktop' })
  expect(await ui.find({ type: 'Image' })).toBe(undefined)
  await ui.unmount()
})
