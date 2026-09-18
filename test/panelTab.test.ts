/**
 * 面板标签页标题口径的单测（#212）。标签页标题是 VS Code 宿主侧的东西，浏览器验证
 * （实验室）看不见它，所以这一条以纯函数 + 静态判据为准（见 panelTabWiring.test.ts）。
 *
 * 钉住三件事：格式统一（`dsh · <主体>`）、对话的回退链（会话标题 → 工作区名 →「对话」）、
 * 以及**绝不出现会话 id 片段与「装配」这类内部词**（#212 之前未知态就是 `dsh: session-47…`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PANEL_TAB_ICON_PATH,
  PANEL_TAB_PRODUCT,
  PANEL_TAB_SEPARATOR,
  chatPanelSubject,
  chatPanelTabTitle,
  panelTabTitle,
} from '../src/pure/panelTab.ts'

const CHAT = '对话'

test('标题格式统一为「dsh · 主体」', () => {
  assert.equal(panelTabTitle('设置'), 'dsh · 设置')
  assert.equal(panelTabTitle('Settings'), 'dsh · Settings')
  assert.equal(chatPanelTabTitle({ sessionTitle: '修标签页标题', chatLabel: CHAT }), 'dsh · 修标签页标题')
})

test('前缀与分隔符从常量来（改口径只改一处）', () => {
  assert.equal(panelTabTitle('设置'), `${PANEL_TAB_PRODUCT}${PANEL_TAB_SEPARATOR}设置`)
})

test('对话标题的回退链：会话标题 → 工作区名 →「对话」', () => {
  const base = { workspaceName: 'dsh-one', chatLabel: CHAT }
  assert.equal(chatPanelSubject({ ...base, sessionTitle: '会话标题' }), '会话标题')
  assert.equal(chatPanelSubject(base), 'dsh-one')
  assert.equal(chatPanelSubject({ chatLabel: CHAT }), CHAT)
})

test('空白串算「还不知道」，继续往下退（不是空标题、也不是空白标题）', () => {
  assert.equal(chatPanelSubject({ sessionTitle: '   ', workspaceName: 'dsh-one', chatLabel: CHAT }), 'dsh-one')
  assert.equal(chatPanelSubject({ sessionTitle: '', workspaceName: ' ', chatLabel: CHAT }), CHAT)
  // 名字带的空格要修掉：VS Code 标签页本来就窄，别浪费在首尾空白上
  assert.equal(chatPanelTabTitle({ sessionTitle: '  标题  ', chatLabel: CHAT }), 'dsh · 标题')
})

test('任何回退档都不出现会话 id 片段这类形态', () => {
  const titles = [
    chatPanelTabTitle({ sessionTitle: '会话标题', workspaceName: 'dsh-one', chatLabel: CHAT }),
    chatPanelTabTitle({ workspaceName: 'dsh-one', chatLabel: CHAT }),
    chatPanelTabTitle({ chatLabel: CHAT }),
    panelTabTitle('Settings'),
    panelTabTitle('Install dsh'),
  ]
  for (const title of titles) {
    assert.doesNotMatch(title, /^dsh:/, `标题不该用冒号分隔：${title}`)
    assert.doesNotMatch(title, /session-|sess_/i, `标题不该出现会话 id 片段：${title}`)
  }
})

test('标题里不再有「（装配）」这类内部词', () => {
  const titles = [
    chatPanelTabTitle({ chatLabel: CHAT }),
    chatPanelTabTitle({ sessionTitle: '会话', chatLabel: CHAT }),
    panelTabTitle('设置'),
    panelTabTitle('Settings'),
    panelTabTitle('安装 dsh'),
  ]
  for (const title of titles) {
    assert.doesNotMatch(title, /（装配）|\(assembled\)/i, `内部词漏进用户视线：${title}`)
  }
})

test('图标路径是扩展根下的现成资源（dsh 官方品牌 favicon，与 #68 之前那版实现同一份）', () => {
  assert.equal(PANEL_TAB_ICON_PATH, 'assets/dsh-favicon.svg')
})
