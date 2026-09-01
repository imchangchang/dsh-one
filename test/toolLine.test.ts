import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isCommandTool,
  prettyJson,
  toolAction,
  truncateLines,
  OUTPUT_PREVIEW_LINES,
} from '../src/pure/toolLine.ts'

test('known tool names map to kimi-cli style action phrases', () => {
  assert.equal(toolAction('bash'), 'Ran a command')
  assert.equal(toolAction('read'), 'Read')
  assert.equal(toolAction('write'), 'Using Write')
  assert.equal(toolAction('str_replace_editor'), 'Edited')
  assert.equal(toolAction('web_search'), 'Searched the web')
  assert.equal(toolAction('task'), 'Ran a subagent')
})

test('matching is case-insensitive with substring fallback', () => {
  assert.equal(toolAction('Bash'), 'Ran a command')
  assert.equal(toolAction('mcp__filesystem__read_file'), 'Read')
  assert.equal(toolAction('some_edit_tool'), 'Edited')
})

test('unknown tools keep their raw name', () => {
  assert.equal(toolAction('mystery_tool'), 'mystery_tool')
})

test('isCommandTool flags bash/shell variants only', () => {
  assert.equal(isCommandTool('bash'), true)
  assert.equal(isCommandTool('Shell'), true)
  assert.equal(isCommandTool('read'), false)
})

test('outputs within the preview limit pass through unchanged', () => {
  const text = 'a\nb\nc'
  assert.deepEqual(truncateLines(text), { preview: text, totalLines: 3, truncated: false })
  const exact = Array.from({ length: OUTPUT_PREVIEW_LINES }, (_, i) => `l${i}`).join('\n')
  assert.equal(truncateLines(exact).truncated, false)
})

test('longer outputs truncate to the first lines with a line count', () => {
  const text = Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n')
  const r = truncateLines(text)
  assert.equal(r.truncated, true)
  assert.equal(r.totalLines, 12)
  assert.equal(r.preview, 'line0\nline1\nline2\nline3\nline4')
})

test('empty and single-line outputs never truncate', () => {
  assert.deepEqual(truncateLines(''), { preview: '', totalLines: 1, truncated: false })
  assert.equal(truncateLines('one line').truncated, false)
})

test('prettyJson pretty-prints valid JSON with two-space indent', () => {
  assert.equal(
    prettyJson('{"command":"ls","cwd":"/tmp"}'),
    '{\n  "command": "ls",\n  "cwd": "/tmp"\n}',
  )
  assert.equal(prettyJson('{"todos":[{"content":"a"}]}'), '{\n  "todos": [\n    {\n      "content": "a"\n    }\n  ]\n}')
})

test('prettyJson falls back to raw text on invalid JSON', () => {
  assert.equal(prettyJson('{not json'), '{not json')
  assert.equal(prettyJson(''), '')
})
