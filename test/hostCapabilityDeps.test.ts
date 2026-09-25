/**
 * 宿主能力**拼装完备性**的常驻判据（#247 返修）。
 *
 * 为什么需要这一组（而不是只靠装配实验室 + 真机脚本）：一条能力调用的两端是「页面叫得动」
 * （走能力口发出 `dshOne.hostCall`）与「宿主搬得对」（`hostBridgeDeps()` 把调用方给的每条
 * 能力原样搬进 deps，`hostBridge.ts` 的派发表据此执行）。**实验室验的是前一半**：那里的
 * 假宿主（`test/assembly-lab/fakeHost.ts`）自己应答 `vscode.*` 调用，页面叫得动就绿——真宿主
 * 那份 deps 拼装从头到尾没被跑到。#247 的现场正是这样穿透的：`hostBridgeDeps()` 少搬了
 * `openPlugins` 一条，派发表里的 `deps.openPlugins === undefined` 恒真，于是用户点侧栏那条
 * 「插件」行永远得到 `unsupported`（用户机器日志原文 `host call vscode.openPlugins rejected:
 * unsupported`），而实验室的 F-74 与真机脚本全绿。
 *
 * 所以这里跑的是**真宿主那份拼装代码**（`src/ui/assemblyView.ts`，经
 * `test/chatPanelLiveness/` 的模块钩子把裸模块名 `vscode` 指到假模块）：
 * 1. 直接对 `hostBridgeDeps()` 断言：给了的每一条能力都必须**原样**出现在返回的 deps 里，
 *    漏一条即红、且报错点名是哪个键。测试对象按 `Required<SidebarPanelActions>` 标注，
 *    所以日后往那份类型里加第五条却忘了搬，`npm run typecheck` 先红（运行时判据只在
 *    「类型里有、拼装里漏」时兜底）；
 * 2. 端到端再走一遍用户那条路：侧栏 webview 发 `vscode.openPlugins` → 必须真的开出
 *    `dshOne.assembledPlugins` 面板，且**不得**出现那条 `rejected: unsupported`。
 *
 * 负向对照（读数写在本任务的报告里）：把 `hostBridgeDeps` 里 `openPlugins` 那条展开删掉，
 * 下面两条当场红——第一条点名 `openPlugins`，第二条复现用户现场那一行；还原即绿。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { loadSource, resolveSpecifier } from './chatPanelLiveness/vscodeHooks.ts'
import { startHarness } from './chatPanelLiveness/harness.ts'
import type { SidebarPanelActions } from '../src/ui/assemblyView.ts'
import type { Logger } from '../src/log.ts'
import type { ServerManager } from '../src/server/manager.ts'

// 装模块钩子（`vscode` → 假模块；`.ts` 过一遍类型转换）。必须早于任何 import src/**，
// 所以真宿主代码一律在用例里动态 import。
registerHooks({ resolve: resolveSpecifier, load: loadSource } as never)

/**
 * 这份能力表今天就是这四条（与 `SidebarPanelActions` 一一对应）。写死一份是为了两头都堵：
 * 类型**加了**一条而测试对象没跟 → `Required<…>` 标注过不了 typecheck；类型**少了**一条
 * 而这份清单没跟 → 下面的 deepEqual 当场红。
 */
const EXPECTED_KEYS = ['openSettings', 'createWorkspaceDirectory', 'newSessionInWorkspace', 'openPlugins'] as const

/** 真宿主那份装配（`src/ui/assemblyView.ts`）：模块钩子装好之后才 import。 */
async function loadHost(): Promise<typeof import('../src/ui/assemblyView.ts')> {
  return await import('../src/ui/assemblyView.ts')
}

/** `hostBridgeDeps` 要的那两件：本组判据不碰服务状态与会话清单，给最小替身即可。 */
const managerStub = { getStatus: () => ({ state: 'stopped' as const }) } as unknown as ServerManager
const loggerStub = { info: () => {}, warn: () => {}, error: () => {} } as unknown as Logger

test('hostBridgeDeps：panelActions 给了的每一条都必须原样出现在 deps 里（#247 的漏键现场）', async () => {
  const view = await loadHost()
  const actions: Required<SidebarPanelActions> = {
    openSettings: () => {},
    createWorkspaceDirectory: async () => ({ workspaceId: 'lab-workspace' }),
    newSessionInWorkspace: () => {},
    openPlugins: () => {},
  }
  assert.deepEqual(Object.keys(actions).sort(), [...EXPECTED_KEYS].sort(), '这份能力表变了：测试对象要与 SidebarPanelActions 同步')

  const deps = view.hostBridgeDeps(managerStub, loggerStub, undefined, actions)
  for (const key of Object.keys(actions) as Array<keyof Required<SidebarPanelActions>>) {
    // 引用相等（不是「长得像」）：deps 里搬的必须是调用方给的那一个函数，页面调它才落到
    // 真正的动作上。undefined = 这一条没搬进来，页面调它恒得到 unsupported。
    assert.equal(
      deps[key],
      actions[key],
      `deps 里没有这一条能力：${key}（SidebarPanelActions 与 hostBridge.ts 的派发表里都有它，装配时漏搬 = 页面调它恒回 unsupported）`,
    )
  }
})

test('hostBridgeDeps：没给 panelActions 时这四条一律缺席（别的页面不显示那几枚入口，是刻意的缺省）', async () => {
  const view = await loadHost()
  const deps = view.hostBridgeDeps(managerStub, loggerStub)
  for (const key of EXPECTED_KEYS) {
    assert.equal(deps[key], undefined, `${key} 在没给 panelActions 时不该有实现（那几枚入口是侧栏专属）`)
  }
})

/** 侧栏 webview 收到的能力回执（`dshOne.hostResult`）。 */
function hostResultReplies(h: Awaited<ReturnType<typeof startHarness>>): Array<{ ok?: unknown; error?: unknown }> {
  return h.sidebarWebview.sent.filter(
    (message): message is { ok?: unknown; error?: unknown } =>
      typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'dshOne.hostResult',
  )
}

test('侧栏那一行「插件」的宿主端到端：vscode.openPlugins 真的开出插件页，且不回 unsupported', async () => {
  const h = await startHarness()
  try {
    // 页面那一半（官方侧栏行的点击 → layout 服务 → 能力口）由实验室的 F-74 验；这里送的是
    // 它到宿主的那一步，也就是 #247 断掉的那一步。
    h.pluginsRowClick()

    await h.waitFor('宿主回执', () => hostResultReplies(h).length === 1, 3_000)
    const reply = hostResultReplies(h)[0]!
    // 这一步的失败信息就是用户现场那一行（`host call vscode.openPlugins rejected: unsupported`）
    // ——能力没搬进 deps 时派发表走的就是它。
    assert.equal(
      reply.ok,
      true,
      `这条调用被宿主拒了：${h.lines(/host call vscode\.openPlugins rejected/).join(' | ')} ${JSON.stringify(reply.error ?? null)}`,
    )

    await h.waitFor('插件页面板建出来', () => h.panels.some((panel) => panel.viewType === 'dshOne.assembledPlugins'))
    const panel = h.panels.find((entry) => entry.viewType === 'dshOne.assembledPlugins')!
    await h.waitFor('插件页装上装配页', () => panel.webview.html.includes('__DSH_BOOT__'))

    assert.equal(h.messages.length, 0, '开这一页不该弹任何提示')
    assert.deepEqual(h.lines(/^plugins panel created$/), ['plugins panel created'], '宿主侧的建面板留痕')
  } finally {
    await h.close()
  }
})
