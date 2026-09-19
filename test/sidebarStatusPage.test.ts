/**
 * 侧栏状态页与安装引导 tab 的单测（#100）：
 * - 三态分流判定（未安装 / 服务未运行或启动中 / 装配失败）——判错会让用户去查一
 *   个他解决不了的错误（dsh 没装却报「装配失败」），所以每条分流都得钉住；
 * - 引导 tab 的单例行为（再打开一次只聚焦，不新开第二个 tab）；
 * - 安装命令生成（现有 pure/installScript.ts 的逻辑补断言）；
 * - 状态页跟随服务状态变化的订阅生命周期（#101：重绘 / 退订 / 不重复订阅）。
 *
 * 页面 HTML 本身由宿主侧渲染（`vscode.l10n.t`），单测只覆盖判定与数据；
 * 三态各自画成什么样（文案、按钮、明暗两态）由浏览器冒烟覆盖
 * （`test/install-guide/`，`npm run verify:install-guide`）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideSidebarStatus, assemblyFailureView, type SidebarHostStatus } from '../src/pure/sidebarStatus.ts'
import { createStatusFollow, type StatusChangeSource } from '../src/pure/sidebarStatusFollow.ts'
import { createPanelSlot } from '../src/pure/panelSlot.ts'
import {
  DSH_INSTALL_SCRIPT_BASE,
  INSTALL_SCRIPT_OS_LABEL,
  INSTALL_SCRIPT_OS_ORDER,
  hostOsFromPlatform,
  installCommandFor,
  installOsOrDefault,
  type HostOs,
} from '../src/pure/installScript.ts'

/* ---------- 三态分流 ---------- */

test('未安装：reason=dshNotFound 走「未安装」，不落装配失败', () => {
  const decision = decideSidebarStatus({ state: 'error', reason: 'dshNotFound', error: 'dsh not found' })
  assert.deepEqual(decision, { kind: 'notInstalled' })
})

test('未安装优先于装配失败：装配过程中发现的「没装」也走「未安装」', () => {
  const status: SidebarHostStatus = { state: 'error', reason: 'dshNotFound', error: 'dsh not found' }
  assert.deepEqual(assemblyFailureView(status, 'GET /: HTTP 401'), { kind: 'notInstalled' })
})

test('服务未运行（stopped）：给「启动 dsh 服务」', () => {
  const decision = decideSidebarStatus({ state: 'stopped' })
  assert.deepEqual(decision, { kind: 'serviceDown', starting: false })
})

test('启动中（starting）：只显示进度文案（starting=true，页面据此不给启动按钮）', () => {
  const decision = decideSidebarStatus({ state: 'starting' })
  assert.deepEqual(decision, { kind: 'serviceDown', starting: true })
})

test('启动失败但非「没装」（如端口上是认证实例）：带详情，仍走「服务未运行」', () => {
  const decision = decideSidebarStatus({
    state: 'error',
    reason: 'authDshNoToken',
    error: 'Port 3080 runs an authenticated dsh instance started outside this extension.',
  })
  assert.deepEqual(decision, {
    kind: 'serviceDown',
    starting: false,
    detail: 'Port 3080 runs an authenticated dsh instance started outside this extension.',
  })
})

test('服务在跑：判定交给装配，并把网关地址带出去', () => {
  const decision = decideSidebarStatus({ state: 'running', url: 'http://127.0.0.1:3080' })
  assert.deepEqual(decision, { kind: 'assemble', url: 'http://127.0.0.1:3080' })
})

test('服务报 running 却没有地址（不该发生）：当服务未运行处理，不去装配', () => {
  const decision = decideSidebarStatus({ state: 'running' })
  assert.deepEqual(decision, { kind: 'serviceDown', starting: false })
})

test('装配失败：带原因走「装配失败」（服务在跑、只是装不起来）', () => {
  const status: SidebarHostStatus = { state: 'running', url: 'http://127.0.0.1:3080' }
  assert.deepEqual(assemblyFailureView(status, 'GET /: HTTP 500'), {
    kind: 'assemblyFailed',
    detail: 'GET /: HTTP 500',
  })
})

/* ---------- 引导 tab 单例 ---------- */

/** 面板替身：记下被 reveal 过几次；`disposed` 表示用户把它关了。 */
interface FakePanel {
  revealed: number
  reveal(): void
}

function fakePanel(): FakePanel {
  return {
    revealed: 0,
    reveal() {
      this.revealed += 1
    },
  }
}

test('引导 tab 单例：第一次打开新建，第二次只聚焦同一个面板', () => {
  const slot = createPanelSlot<FakePanel>()
  let created = 0
  const first = slot.open(() => {
    created += 1
    return fakePanel()
  })
  assert.equal(created, 1)
  assert.equal(first.revealed, 0)

  const second = slot.open(() => {
    created += 1
    return fakePanel()
  })
  assert.equal(created, 1, '已开就不该再新建面板')
  assert.equal(second, first)
  assert.equal(first.revealed, 1)
})

test('引导 tab 被用户关掉后槽位空出来：下次打开新建一个（不是复用已关的）', () => {
  const slot = createPanelSlot<FakePanel>()
  const first = slot.open(fakePanel)
  slot.close(first)
  assert.equal(slot.current(), undefined)

  const second = slot.open(fakePanel)
  assert.notEqual(second, first)
  assert.equal(second.revealed, 0)
})

test('误导性关闭不动新面板：先开的面板关晚了，不清掉替换后的那个', () => {
  const slot = createPanelSlot<FakePanel>()
  const first = slot.open(fakePanel)
  slot.close(first)
  const second = slot.open(fakePanel)
  slot.close(first)
  assert.equal(slot.current(), second, '关的是旧句柄，当前面板不该被清掉')
})

/* ---------- 状态页跟随服务状态变化（#101） ---------- */

/** 状态替身：这里只验「转发了哪一次状态」，取值够用即可。 */
type FakeStatus = { state: string }

/** 假的事件源：手工 fire，并记下登记了几份监听（用来钉「不泄漏监听」）。 */
function fakeStatusSource(): {
  source: StatusChangeSource<FakeStatus>
  fire(status: FakeStatus): void
  listeners(): number
} {
  const registered = new Set<(status: FakeStatus) => void>()
  return {
    source: {
      onDidChangeState(listener) {
        registered.add(listener)
        return { dispose: () => registered.delete(listener) }
      },
    },
    fire(status) {
      // 照事件源的真实语义：一份监听被退订后不该再收到。
      for (const listener of [...registered]) listener(status)
    },
    listeners: () => registered.size,
  }
}

test('状态页跟随：服务状态一变就按新状态重画，位置与次数都对', () => {
  const events = fakeStatusSource()
  const seen: FakeStatus[] = []
  const follow = createStatusFollow<FakeStatus>({
    source: events.source,
    isStatusShown: () => true,
    onStatusChanged: (status) => seen.push(status),
  })

  events.fire({ state: 'running' })
  assert.deepEqual(seen, [], '还没开始跟随，状态变化不该动页面')

  follow.start()
  events.fire({ state: 'starting' })
  events.fire({ state: 'stopped' })
  assert.deepEqual(seen, [{ state: 'starting' }, { state: 'stopped' }], '每次变化都跟着重画一次')

  follow.stop()
  events.fire({ state: 'running' })
  assert.equal(seen.length, 2, '退订之后不再重画')
  follow.stop() // 重复退订不该炸
})

test('状态页跟随：装配页在位时不抢它的刷新', () => {
  const events = fakeStatusSource()
  let statusShown = false
  let redrawn = 0
  const follow = createStatusFollow<FakeStatus>({
    source: events.source,
    isStatusShown: () => statusShown,
    onStatusChanged: () => (redrawn += 1),
  })
  follow.start()

  events.fire({ state: 'stopped' })
  assert.equal(redrawn, 0, '画的是装配页：状态变化不该把页面换掉')

  statusShown = true
  events.fire({ state: 'stopped' })
  assert.equal(redrawn, 1, '状态页回到视图里之后就跟着画')
})

test('状态页跟随：重复开始不会挂出第二份监听（每多一份就多重画一次）', () => {
  const events = fakeStatusSource()
  let redrawn = 0
  const follow = createStatusFollow<FakeStatus>({
    source: events.source,
    isStatusShown: () => true,
    onStatusChanged: () => (redrawn += 1),
  })

  follow.start()
  follow.start()
  assert.equal(events.listeners(), 1)
  events.fire({ state: 'stopped' })
  assert.equal(redrawn, 1)

  // 视图重新可见（收起又展开）走的就是 stop → start：监听数仍是一份。
  follow.stop()
  assert.equal(events.listeners(), 0)
  follow.start()
  assert.equal(events.listeners(), 1)
  assert.equal(follow.started(), true)
  events.fire({ state: 'running' })
  assert.equal(redrawn, 2)
})

/* ---------- 安装命令生成 ---------- */

test('各平台一键安装命令：Windows 走 irm|iex，macOS/Linux 走 curl|bash', () => {
  assert.equal(
    installCommandFor('windows'),
    `irm ${DSH_INSTALL_SCRIPT_BASE}/dsh-install.ps1 | iex`,
  )
  assert.equal(
    installCommandFor('macos'),
    `curl -fsSL ${DSH_INSTALL_SCRIPT_BASE}/dsh-install.sh | bash`,
  )
  assert.equal(installCommandFor('linux'), installCommandFor('macos'))
})

test('宿主平台映射：win32/darwin/linux 三个认得，其它平台 undefined', () => {
  assert.equal(hostOsFromPlatform('win32'), 'windows')
  assert.equal(hostOsFromPlatform('darwin'), 'macos')
  assert.equal(hostOsFromPlatform('linux'), 'linux')
  assert.equal(hostOsFromPlatform('freebsd'), undefined)
})

test('引导页默认平台：认不出宿主平台时回退第一项', () => {
  assert.equal(installOsOrDefault('macos'), 'macos')
  assert.equal(installOsOrDefault(undefined), INSTALL_SCRIPT_OS_ORDER[0])
})

test('平台顺序与标签覆盖全部平台（下拉选项不漏项）', () => {
  const labelled: HostOs[] = INSTALL_SCRIPT_OS_ORDER.filter((os) => INSTALL_SCRIPT_OS_LABEL[os] !== undefined)
  assert.deepEqual(labelled, INSTALL_SCRIPT_OS_ORDER)
  assert.deepEqual(INSTALL_SCRIPT_OS_ORDER, ['windows', 'macos', 'linux'])
})
