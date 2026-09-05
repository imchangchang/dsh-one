import { test } from 'node:test'
import assert from 'node:assert/strict'
import { steerModifierLabel } from '../src/pure/steerShortcut.ts'

test('steerModifierLabel：macOS 用 ⌘，Windows/Linux 用 Ctrl，未知平台回退 ⌘', () => {
  assert.equal(steerModifierLabel('macos'), '⌘')
  assert.equal(steerModifierLabel('windows'), 'Ctrl')
  assert.equal(steerModifierLabel('linux'), 'Ctrl')
  assert.equal(steerModifierLabel(undefined), '⌘')
})
