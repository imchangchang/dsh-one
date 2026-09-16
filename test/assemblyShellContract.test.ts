/**
 * 装配骨架与官方外框契约的对照测试（#76）：
 * 三棵树的 block list 都下线了官方 `dsh-client-ui-layout`，官方外框原本下发给
 * root 槽位的契约就得由自有骨架提供。0.1.6 漏掉 `panelInfo` 钩子导致侧栏会话
 * 列表整块消失，所以这里把「接手的契约」写成可执行的清单——源码级核对（与
 * pluginLocales.test.ts 同款做法：这些插件运行时依赖 react / 官方私有包，
 * 单测里 import 不进来，只能扫源码）。
 *
 * 清单来源：官方 `dsh-client-ui-layout` 0.1.6 的 `client.js` apply() 与
 * `lib/types/client/{index,service,stores}.d.ts`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SHELL_DIR = path.join(import.meta.dirname, '..', 'src', 'ui', 'assembly', 'shell')

const read = (file: string): string => fs.readFileSync(path.join(SHELL_DIR, file), 'utf8')

/** 三棵树的 frame 插件（官方 ui-layout 的角色承担者）。 */
const SHELLS = ['shellPlugin.ts', 'sidebarFramePlugin.ts', 'settingsFramePlugin.ts']

test('三棵树的 frame 插件都提供官方 root 槽位钩子 panelInfo（#76 现场缺陷）', () => {
  for (const file of SHELLS) {
    const text = read(file)
    assert.match(text, /provideRoot\(\{\s*hooks:\s*\{\s*panelInfo:|provideRoot\(\{\s*hooks:\s*\{\s*panelInfo\s*\}/, `${file} 必须经 ctx.slots.provideRoot 提供 panelInfo`)
    assert.match(text, /PANEL_INFO_SOURCE/, `${file} 的 panelInfo 源必须取共享件 PANEL_INFO_SOURCE`)
    assert.match(text, /disposePanelInfo\(\)/, `${file} 必须在 effect 清理里撤销 panelInfo 贡献`)
  }
})

test('panelInfo 源：快照形状与官方 PanelInfo 一致、引用稳定、可撤销订阅', () => {
  const text = read('frameShared.ts')
  // 官方 stores.d.ts 的 PanelInfo = { activePanelId: MainPanelId | null }
  assert.match(text, /activePanelId:\s*string \| null/, 'panelInfo 快照必须带 activePanelId 字段')
  // 快照必须是模块级常量：官方把它交给 useSyncExternalStoreWithSelector，
  // 每次 getSnapshot 返回新对象会无限重渲。
  assert.match(text, /const PANEL_INFO_SNAPSHOT:\s*PanelInfoSnapshot\s*=\s*\{\s*activePanelId:\s*null\s*\}/, '快照必须是模块级常量')
  assert.match(text, /getSnapshot:\s*\(\)[^=>]*=>\s*PANEL_INFO_SNAPSHOT/, 'getSnapshot 必须返回同一个引用')
  assert.match(text, /subscribe:[\s\S]{0,120}?=>\s*\(\)\s*=>\s*\{\}/, 'subscribe 必须返回可调用的撤销函数')
})

test('layout 服务面覆盖官方 ILayout 全成员（官方 service.d.ts 清单）', () => {
  // 官方 0.1.6 ILayout：selectPanel / beginNavigation / toggleSidebar /
  // openRightbar / closeRightbar（加官方类的 dispose）。
  const official = ['selectPanel', 'beginNavigation', 'toggleSidebar', 'openRightbar', 'closeRightbar', 'dispose']
  const text = read('frameShared.ts')
  const classBody = /export class LayoutController \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ''
  for (const member of official) {
    assert.ok(
      new RegExp(`\\b${member}\\s*\\(`).test(classBody),
      `LayoutController 必须实现官方 ILayout 成员 ${member}（）`,
    )
  }
  // 官方语义：未注册的 keyed main 面板要照官方抛同一条错（不是静默吞掉）。
  assert.match(classBody, /layout\.selectPanel: main panel/, 'selectPanel 的非法目标要照官方文案抛错')
  // beginNavigation 必须作废上一次导航（AbortController 语义）。
  assert.match(classBody, /new AbortController\(\)/, 'beginNavigation 必须给出可作废的 AbortSignal')
})

test('chat 树：会话面板两版槽位都声明（0.1.2 的 single conversation / 0.1.6 的 keyed main）', () => {
  const text = read('shellPlugin.ts')
  assert.match(text, /conversation:\s*\{\s*kind:\s*'single',\s*scope:\s*'session-maybe'\s*\}/, '0.1.2 线的 single conversation 槽位要保留')
  assert.match(text, /main:\s*\{\s*kind:\s*'keyed',\s*scope:\s*'root'\s*\}/, '0.1.6 线的 keyed main 槽位要声明')
  // 渲染取键方式与官方 AppFrame 的 MainPanel 一致：activePanelId ?? 'conversation'
  assert.match(text, /renderSlot\('main', \{\}, \{ entryKey: activePanelId \?\? 'conversation' \}\)/, 'main 槽位必须按官方取键渲染')
  assert.match(text, /renderSlot\('conversation', \{\}\)/, 'single conversation 槽位要保留渲染分支')
})
