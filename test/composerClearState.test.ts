/**
 * 清空三件套的状态判定单测（#65 批 1）：行为矩阵 = issue #16 的语义定稿——
 * 撤销 > 清空（双击确认）> 停止回合，运行中有内容只清空不打断。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearButtonView, decideClearAction, type ClearButtonState } from '../src/pure/composerClearState.ts'

const state = (over: Partial<ClearButtonState>): ClearButtonState => ({
  armed: false,
  undoOpen: false,
  hasContent: false,
  running: false,
  ...over,
})

test('撤销窗口开着时任何点击都走撤销', () => {
  assert.equal(decideClearAction(state({ undoOpen: true, hasContent: true, running: true })), 'undo')
  assert.equal(decideClearAction(state({ undoOpen: true })), 'undo')
})

test('有内容：第一次按武装，第二次按清空（需双击确认）', () => {
  assert.equal(decideClearAction(state({ hasContent: true })), 'arm')
  assert.equal(decideClearAction(state({ hasContent: true, armed: true })), 'clear')
})

test('运行中有内容：只清空，不停止回合（先清输入）', () => {
  assert.equal(decideClearAction(state({ hasContent: true, running: true })), 'arm')
  assert.equal(decideClearAction(state({ hasContent: true, running: true, armed: true })), 'clear')
})

test('运行中无内容：按下去停止回合（清完了才轮到停）', () => {
  assert.equal(decideClearAction(state({ running: true })), 'stop')
})

test('无内容且未运行：无事可做（按钮禁用）', () => {
  assert.equal(decideClearAction(state({})), 'none')
})

test('按钮形态：文案与禁用态逐档正确', () => {
  assert.deepEqual(clearButtonView(state({})), { labelKey: 'clear', hintKey: 'clearHint', disabled: true })
  assert.deepEqual(clearButtonView(state({ hasContent: true })), { labelKey: 'clear', hintKey: 'clearHint', disabled: false })
  assert.deepEqual(clearButtonView(state({ hasContent: true, armed: true })), {
    labelKey: 'armHint',
    hintKey: 'armHint',
    disabled: false,
  })
  assert.deepEqual(clearButtonView(state({ running: true })), { labelKey: 'stop', hintKey: 'stopHint', disabled: false })
  assert.deepEqual(clearButtonView(state({ undoOpen: true })), { labelKey: 'cleared', hintKey: 'undoHint', disabled: false })
})
