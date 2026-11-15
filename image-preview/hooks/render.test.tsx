import { expect, test } from 'claude-code/testing'

// A 1x1 PNG, small enough to go to the terminal as bytes with no conversion.
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function readRow(output: unknown) {
  return {
    plugin: 'image-preview',
    component: 'ToolUse',
    requestId: 'toolu_1',
    viewport: { columns: 100, rows: 40 },
    props: {
      tool_use_id: 'toolu_1',
      tool: 'Read',
      input: { file_path: '/tmp/dot.png' },
      isRunning: false,
      isErrored: false,
      isInterrupted: false,
      output,
    },
  } as const
}

test('a Read of a PNG draws the picture under the row', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Read(dot.png)</Text>
  })
  const output = {
    type: 'image',
    file: {
      base64: ONE_PIXEL_PNG,
      type: 'image/png',
      originalSize: 70,
      dimensions: { displayWidth: 1, displayHeight: 1 },
    },
  }
  const ui = await $.ui.mount({ ...readRow(output), surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /Read/ }))?.text).toBe('Read(dot.png)')
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ png: ONE_PIXEL_PNG })
  expect(image?.props.columns).toBe(1)
  await ui.unmount()
})

test('a Read of text draws only the row', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Read(notes.md)</Text>
  })
  const output = { type: 'text', file: { filePath: '/tmp/notes.md', content: 'hi' } }
  const ui = await $.ui.mount({ ...readRow(output), surface: 'terminal' })

  expect(await ui.find({ type: 'Image' })).toBe(undefined)
  await ui.unmount()
})

test('other surfaces get the row without a picture', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Read(dot.png)</Text>
  })
  const output = {
    type: 'image',
    file: { base64: ONE_PIXEL_PNG, type: 'image/png', originalSize: 70,
      dimensions: { displayWidth: 1, displayHeight: 1 } },
  }
  const ui = await $.ui.mount({ ...readRow(output), surface: 'desktop' })

  expect(await ui.find({ type: 'Image' })).toBe(undefined)
  await ui.unmount()
})
