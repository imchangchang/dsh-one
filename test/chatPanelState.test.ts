/**
 * 对话面板序列化状态的单测（#169）：钉住「页面存什么形状 → 宿主怎么读回来」
 * 这条跨进程约定，以及恢复时的落位规则（单例只允许一个）。
 *
 * 宿主行为（VS Code 真的在重载后把标签页交回来）实验室到不了真宿主，所以这里
 * 验的是能自动化的那一半：state 的存取与降级分支。真宿主的验收步骤写在
 * docs/development.md「日志与事后取证」一节（切走窗口再回来 / Reload Window）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  ASSEMBLED_CHAT_VIEW_TYPE,
  CHAT_PANEL_STATE_VERSION,
  decodeChatPanelState,
  encodeChatPanelState,
  placeRestoredChatPanel,
} from '../src/pure/chatPanelState.ts'

test('存下来的状态能原样读回来（会话 id + 面板形态）', () => {
  const state = encodeChatPanelState({ sessionId: 'session-abc', tab: true })
  assert.deepEqual(state, { v: CHAT_PANEL_STATE_VERSION, sessionId: 'session-abc', tab: true })
  assert.deepEqual(decodeChatPanelState(state), { sessionId: 'session-abc', tab: true })
})

test('没有会话的面板存 null、读回来是 undefined（跟官方恢复值走）', () => {
  const state = encodeChatPanelState({ sessionId: undefined, tab: false })
  assert.equal(state.sessionId, null)
  assert.deepEqual(decodeChatPanelState(state), { sessionId: undefined, tab: false })
})

test('看不懂的 state 一律返回 undefined（调用方按老面板恢复）', () => {
  // 页面从没写过（本次改动之前开着的面板就是这样）
  assert.equal(decodeChatPanelState(undefined), undefined)
  assert.equal(decodeChatPanelState(null), undefined)
  assert.equal(decodeChatPanelState('session-abc'), undefined)
  assert.equal(decodeChatPanelState(42), undefined)
  // 版本不认识（将来换了形状的老数据）
  assert.equal(decodeChatPanelState({ v: 99, sessionId: 'session-abc', tab: false }), undefined)
  // 字段类型不对
  assert.equal(decodeChatPanelState({ v: CHAT_PANEL_STATE_VERSION, sessionId: 5, tab: false }), undefined)
  // 空串按「没有会话」算，不当作会话 id 注进页面
  assert.deepEqual(decodeChatPanelState({ v: CHAT_PANEL_STATE_VERSION, sessionId: '', tab: true }), {
    sessionId: undefined,
    tab: true,
  })
})

test('缺 tab 字段按单例算（字段是后来加的，老数据不该变成多开）', () => {
  assert.deepEqual(decodeChatPanelState({ v: CHAT_PANEL_STATE_VERSION, sessionId: 'session-abc' }), {
    sessionId: 'session-abc',
    tab: false,
  })
})

test('落位：多开的还是多开，单例抢不到槽位就降级成标签页', () => {
  assert.equal(placeRestoredChatPanel({ sessionId: 's1', tab: true }, { singletonOpen: false }), 'tab')
  assert.equal(placeRestoredChatPanel({ sessionId: 's1', tab: false }, { singletonOpen: false }), 'singleton')
  // 槽位被占（它恢复得晚，或别处已经开了一个）：不顶掉在位的那个
  assert.equal(placeRestoredChatPanel({ sessionId: 's1', tab: false }, { singletonOpen: true }), 'tab')
})

test('package.json 必须声明 onWebviewPanel:<view type> 激活事件（恢复发生在激活之前）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    activationEvents?: string[]
  }
  assert.equal(ASSEMBLED_CHAT_VIEW_TYPE, 'dshOne.assembledChat')
  assert.ok(
    (pkg.activationEvents ?? []).includes(`onWebviewPanel:${ASSEMBLED_CHAT_VIEW_TYPE}`),
    `package.json 的 activationEvents 里缺 onWebviewPanel:${ASSEMBLED_CHAT_VIEW_TYPE}——` +
      '没有它，窗口重载后扩展不会被唤起，serializer 也就没人注册，标签页照旧被丢掉',
  )
})
