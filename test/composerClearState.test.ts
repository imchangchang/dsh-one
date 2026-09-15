/**
 * 清空键位分流的单测（#65 批 1 收尾改版）：**有内容才接管、空内容一律放行**，
 * 加上 IME / 官方浮层 / 有选区三类放行条件；提示形态随触发键变化。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearHintKind, decideKeyAction, type ClearKeyState } from '../src/pure/composerClearState.ts'

const state = (over: Partial<ClearKeyState>): ClearKeyState => ({
  key: 'escape',
  hasContent: false,
  armed: false,
  hasSelection: false,
  blocked: false,
  composing: false,
  ...over,
})

test('有内容：第一次按武装，第二次按清空（双击确认）', () => {
  assert.equal(decideKeyAction(state({ hasContent: true })), 'arm')
  assert.equal(decideKeyAction(state({ hasContent: true, armed: true })), 'clear')
  // 两条键路语义一致
  assert.equal(decideKeyAction(state({ key: 'ctrl-c', hasContent: true })), 'arm')
  assert.equal(decideKeyAction(state({ key: 'ctrl-c', hasContent: true, armed: true })), 'clear')
})

test('空内容：一律放行（绝不吞键，官方逻辑照常）', () => {
  assert.equal(decideKeyAction(state({})), 'pass')
  assert.equal(decideKeyAction(state({ key: 'ctrl-c' })), 'pass')
  // 武装态但草稿已被别处清空 → 仍然放行
  assert.equal(decideKeyAction(state({ hasContent: false, armed: true })), 'pass')
})

test('运行中双语义：有内容只清不打断、空内容交给官方', () => {
  // 有内容（armed=true 表示第二次按）→ 清空；空内容 → 放行（官方中断入口生效）
  assert.equal(decideKeyAction(state({ hasContent: true, armed: true })), 'clear')
  assert.equal(decideKeyAction(state({ hasContent: false })), 'pass')
})

test('IME 组字中一律放行', () => {
  assert.equal(decideKeyAction(state({ hasContent: true, composing: true })), 'pass')
  assert.equal(decideKeyAction(state({ key: 'ctrl-c', hasContent: true, composing: true })), 'pass')
})

test('官方浮层打开时一律放行（Esc 是它们的关闭语义）', () => {
  assert.equal(decideKeyAction(state({ hasContent: true, blocked: true })), 'pass')
  assert.equal(decideKeyAction(state({ hasContent: true, armed: true, blocked: true })), 'pass')
})

test('有选中文本：Ctrl+C 放行（Win/Linux 复制优先），Esc 不受影响', () => {
  assert.equal(decideKeyAction(state({ key: 'ctrl-c', hasContent: true, hasSelection: true })), 'pass')
  assert.equal(decideKeyAction(state({ key: 'escape', hasContent: true, hasSelection: true })), 'arm')
})

test('提示形态：撤销优先，其次按触发键给对应武装提示', () => {
  assert.equal(clearHintKind({ armed: false, undoOpen: false, armedKey: 'escape' }), null)
  assert.equal(clearHintKind({ armed: true, undoOpen: false, armedKey: 'escape' }), 'arm-escape')
  assert.equal(clearHintKind({ armed: true, undoOpen: false, armedKey: 'ctrl-c' }), 'arm-ctrl-c')
  assert.equal(clearHintKind({ armed: true, undoOpen: true, armedKey: 'escape' }), 'undo')
})
