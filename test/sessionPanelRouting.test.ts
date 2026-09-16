/**
 * 宿主侧「点侧栏会话 → 聊天面板」的判定（#65 返修 7 / #121）。
 *
 * 这里只钉两件事：
 * - `panelShowsSession`（#121）：宿主**现在到底有没有开着**这条会话——侧栏树「点当前
 *   会话行」按它判「就地改名还是按打开处理」。判错的后果就是用户报的那个 bug（点击进了
 *   改名、对话面板永远不出来），所以四种形态逐条钉住；
 * - `routeSelection` / `drainAfterCreate`：一次打开请求该 create / switch / reveal
 *   （#65 返修 7 的启动竞态：默认开一次与用户点击在建同一个面板）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { drainAfterCreate, panelShowsSession, routeSelection } from '../src/pure/sessionPanelRouting.ts'

test('#121 panelShowsSession：单例面板挂着的就是这条会话 → 开着', () => {
  assert.equal(panelShowsSession({ panelSessionId: 'session-1', tabbed: false }, 'session-1'), true)
})

test('#121 panelShowsSession：面板挂着**别的**会话 → 没开（这正是用户报的现场）', () => {
  assert.equal(panelShowsSession({ panelSessionId: 'session-2', tabbed: false }, 'session-1'), false)
})

test('#121 panelShowsSession：根本没有面板 → 没开（启动后还没开过面板的处境）', () => {
  assert.equal(panelShowsSession({ panelSessionId: undefined, tabbed: false }, 'session-1'), false)
})

test('#121 panelShowsSession：这条会话有自己的多开标签页 → 也算开着（它的对话区真的在场）', () => {
  assert.equal(panelShowsSession({ panelSessionId: 'session-2', tabbed: true }, 'session-1'), true)
  assert.equal(panelShowsSession({ panelSessionId: undefined, tabbed: true }, 'session-1'), true)
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
