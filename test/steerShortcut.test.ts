import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isComposerClearChord, steerModifierLabel, undoChordLabel } from '../src/pure/steerShortcut.ts'

test('steerModifierLabel：macOS 用 ⌘，Windows/Linux 用 Ctrl，未知平台回退 ⌘', () => {
  assert.equal(steerModifierLabel('macos'), '⌘')
  assert.equal(steerModifierLabel('windows'), 'Ctrl')
  assert.equal(steerModifierLabel('linux'), 'Ctrl')
  assert.equal(steerModifierLabel(undefined), '⌘')
})

test('isComposerClearChord：两平台都是裸 Ctrl+C（⌘C 归系统复制）', () => {
  const chord = (o: Partial<KeyboardEvent>) => isComposerClearChord({ key: 'c', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })
  assert.equal(chord({ ctrlKey: true }), true)
  // ⌘C 是复制、Ctrl+Shift+C / Ctrl+Alt+C 是别的语义，都不算清空
  assert.equal(chord({ metaKey: true }), false)
  assert.equal(chord({ ctrlKey: true, shiftKey: true }), false)
  assert.equal(chord({ ctrlKey: true, altKey: true }), false)
  assert.equal(chord({ ctrlKey: true, metaKey: true }), false)
  assert.equal(isComposerClearChord({ key: 'v', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }), false)
})

test('undoChordLabel：撤销键按平台惯例出文案（mac ⌘Z / 其他 Ctrl+Z）', () => {
  assert.equal(undoChordLabel('macos'), '⌘Z')
  assert.equal(undoChordLabel('linux'), 'Ctrl+Z')
  assert.equal(undoChordLabel('windows'), 'Ctrl+Z')
  assert.equal(undoChordLabel(undefined), '⌘Z')
})
