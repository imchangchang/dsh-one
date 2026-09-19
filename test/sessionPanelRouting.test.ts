/**
 * 宿主侧「点侧栏会话 → 聊天面板」的判定（#65 返修 7 / #121），以及「面板里开着哪些
 * 会话」这份事实的定义（#147）。
 *
 * 这里钉三件事：
 * - `panelOpenSessionIds`（#121 的判据、#147 起的唯一一份事实）：宿主**现在到底有没有
 *   开着**这条会话——侧栏树「点当前会话行」按它判「就地改名还是按打开处理」，渲染
 *   「跑完还没被打开」那颗绿点时按整份集合判。判错的后果就是用户报的那两个 bug
 *   （点击进了改名、面板永远不出来 / 正开着的会话被亮了绿点），所以四种形态逐条钉住；
 * - `panelSessionsMessage` / `parsePanelSessionsMessage`（#147）：宿主把这份事实推给
 *   装配页的协议（两侧共用一处定义），不认得的形状一律丢掉（= 空集，不抑制任何提醒）；
 * - `routeSelection` / `drainAfterCreate`：一次打开请求该 create / switch / reveal
 *   （#65 返修 7 的启动竞态：默认开一次与用户点击在建同一个面板）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  drainAfterCreate,
  panelOpenSessionIds,
  panelSessionsMessage,
  parsePanelSessionsMessage,
  routeSelection,
} from '../src/pure/sessionPanelRouting.ts'

test('#121/#147 panelOpenSessionIds：单例面板挂着的就是这条会话 → 在集合里', () => {
  assert.deepEqual([...panelOpenSessionIds('session-1', [])], ['session-1'])
})

test('#121/#147 panelOpenSessionIds：面板挂着**别的**会话 → 不在集合里（这正是 #121 报的现场）', () => {
  assert.deepEqual([...panelOpenSessionIds('session-2', [])], ['session-2'])
  assert.equal(panelOpenSessionIds('session-2', []).has('session-1'), false)
})

test('#121/#147 panelOpenSessionIds：根本没有面板 → 空集（启动后还没开过面板的处境）', () => {
  assert.deepEqual([...panelOpenSessionIds(undefined, [])], [])
})

test('#121/#147 panelOpenSessionIds：多开标签页各自算一条（它的对话区真的在场）', () => {
  const ids = panelOpenSessionIds('session-1', ['session-2', 'session-3'])
  assert.deepEqual([...ids].sort(), ['session-1', 'session-2', 'session-3'])
  assert.equal(ids.has('session-4'), false)
})

test('#121/#147 panelOpenSessionIds：单例没挂会话、只有多开标签页时也是集合（#147 的多开现场）', () => {
  assert.deepEqual([...panelOpenSessionIds(undefined, ['session-2'])], ['session-2'])
})

test('#121/#147 panelOpenSessionIds：空串不算一条会话（那不是 id）', () => {
  assert.deepEqual([...panelOpenSessionIds('', ['session-2', ''])], ['session-2'])
})

test('#147 panelSessionsMessage：造出宿主下发的那条消息，去重、丢掉空串', () => {
  assert.deepEqual(panelSessionsMessage(['session-2', 'session-1', 'session-2', '']), {
    type: 'dshOne.panelSessions',
    sessionIds: ['session-2', 'session-1'],
  })
  assert.deepEqual(panelSessionsMessage([]), { type: 'dshOne.panelSessions', sessionIds: [] }, '空集也要发：它就是「一条都没开」')
})

test('#147 parsePanelSessionsMessage：认这条消息（去重、丢掉非字符串与空串）', () => {
  const parsed = parsePanelSessionsMessage({
    type: 'dshOne.panelSessions',
    sessionIds: ['session-1', 'session-1', 42, '', null],
  })
  assert.deepEqual(parsed, ['session-1'])
  assert.deepEqual(parsePanelSessionsMessage({ type: 'dshOne.panelSessions', sessionIds: [] }), [])
})

test('#147 parsePanelSessionsMessage：形状不认识一律 undefined（= 没收到这条事实）', () => {
  assert.equal(parsePanelSessionsMessage(undefined), undefined)
  assert.equal(parsePanelSessionsMessage(null), undefined)
  assert.equal(parsePanelSessionsMessage('dshOne.panelSessions'), undefined)
  assert.equal(parsePanelSessionsMessage({ type: 'dshOne.setTheme', theme: 'dark' }), undefined)
  assert.equal(parsePanelSessionsMessage({ type: 'dshOne.panelSessions' }), undefined, '缺 sessionIds')
  assert.equal(parsePanelSessionsMessage({ type: 'dshOne.panelSessions', sessionIds: 'session-1' }), undefined, 'sessionIds 不是数组')
})

test('routeSelection：没面板 = create、同会话 = reveal（宿主去重）、别的会话 = switch', () => {
  assert.equal(routeSelection({ hasPanel: false }, 'session-1'), 'create')
  assert.equal(routeSelection({ hasPanel: true, panelSessionId: 'session-1' }, 'session-1'), 'reveal')
  assert.equal(routeSelection({ hasPanel: true, panelSessionId: 'session-2' }, 'session-1'), 'switch')
  assert.equal(routeSelection({ hasPanel: true }, 'session-1'), 'switch', '面板存在但还没登记会话 = 要切过去')
})

test('drainAfterCreate：没等待 = 不切；已经在该会话 = 去重（不重复处理）', () => {
  assert.equal(drainAfterCreate('session-1', undefined), undefined)
  assert.equal(drainAfterCreate('session-1', 'session-1'), undefined)
  assert.equal(drainAfterCreate('session-1', 'session-2'), 'session-2')
  assert.equal(drainAfterCreate(undefined, 'session-2'), 'session-2', '新面板没有注入会话时，等待中的请求要兑现')
})
