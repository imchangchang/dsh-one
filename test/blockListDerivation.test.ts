/**
 * block list 补全（#227，`src/pure/blockListDerivation.ts`）的纯函数单测。
 *
 * 规则一句话：**一棵树挡掉的包，凡是等它的 entry 也一起挡掉**（顺着依赖一层层找）。
 * 判据是**服务**（官方 bundle 导出的 `inject` 服务名表），不是 `package.json` 的
 * `dsh.client.inject` 模块 id 表——后者只管装载顺序，按它做闭包会把树木身拆掉
 * （见本文件最后那条用例，它是这处判据的取法自检）。
 *
 * 用例：现场（alpha.2 的 `ui-plan`）、多层依赖、同名服务还有别的提供方时不误伤、
 * 只补不删且到不动点、框架/主机层服务不传播、取法自检（找不到提供方的服务要点出来）、
 * profile 里用户自己装的第三方插件（#242：只报不挡、提供方算数）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FRAMEWORK_SERVICE_NAMES,
  FRAMEWORK_SERVICE_PREFIXES,
  deriveBlockList,
  isFrameworkService,
  unaccountedBlocks,
  unplaceableProfilePlugins,
  unresolvedServices,
  type PluginServiceFace,
} from '../src/pure/blockListDerivation.ts'

const face = (id: string, needs: string[], provides: string[] = []): PluginServiceFace => ({ id, needs, provides })

// 官方 0.1.6-alpha.2 实测形状（`dsh-client-ui-conversation` / `dsh-client-ui-plan` 的
// lib/client.js 导出 inject 与提供服务那几行），只留本条用例用得上的服务名。
const CONVERSATION = face(
  '@deepseek-ai/dsh-client-ui-conversation',
  ['conversation', 'sessions', 'slots', 'uiConversation'],
  ['conversation', 'uiConversation'],
)
const PLAN = face('@deepseek-ai/dsh-client-ui-plan', ['slots', 'remote', 'sessions', 'uiConversation'])
const CHAT = face('@deepseek-ai/dsh-client-ui-chat', ['slots', 'sessions', 'uiWorkspace', 'uiConversation'])

test('现场（#225）：挡了 ui-conversation，等 uiConversation 的 ui-plan 必须一起挡掉', () => {
  const { blocked, added } = deriveBlockList({
    blocked: ['@deepseek-ai/dsh-client-ui-conversation'],
    plugins: [CONVERSATION, PLAN, CHAT],
  })
  assert.deepEqual(blocked, [
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-plan',
    '@deepseek-ai/dsh-client-ui-chat',
  ])
  assert.deepEqual(
    added.map((a) => a.id),
    ['@deepseek-ai/dsh-client-ui-plan', '@deepseek-ai/dsh-client-ui-chat'],
  )
  const plan = added.find((a) => a.id === PLAN.id)
  assert.deepEqual(plan?.waitingFor, ['uiConversation'])
  assert.deepEqual(plan?.providers, ['@deepseek-ai/dsh-client-ui-conversation'])
})

test('多层依赖：提供方被挡 → 依赖它的挡 → 再依赖前者的也挡（一层层找到不动点）', () => {
  const plugins = [
    // c 提供 s-b，b 提供 s-a；c 是手写清单里被挡的那一条。
    face('c', [], ['s-b']),
    face('b', ['s-b'], ['s-a']),
    face('a', ['s-a'], []),
    // 与这条链无关的一件，它的提供方还在，不该被补进来。
    face('unrelated', ['s-other'], []),
    face('other-provider', ['s-other'], []),
  ]
  const { blocked, added } = deriveBlockList({ blocked: ['c'], plugins })
  assert.deepEqual(blocked, ['c', 'b', 'a'])
  // 补入顺序 = 依赖层次：先 b，后 a。
  assert.deepEqual(
    added.map((x) => x.id),
    ['b', 'a'],
  )
})

test('同名服务还有别的提供方时不误伤：自有 frame 插件提供 layout，官方件被挡也不连坐', () => {
  const officialLayout = face('@deepseek-ai/dsh-client-ui-layout', ['slots', 'theme', 'locale'], ['layout'])
  const workspace = face('@deepseek-ai/dsh-client-ui-workspace', ['slots', 'sessions', 'layout'], ['uiWorkspace'])
  const sidebar = face('@deepseek-ai/dsh-client-ui-sidebar', ['slots', 'layout', 'uiWorkspace'], [])
  const withLocal = deriveBlockList({
    blocked: [officialLayout.id],
    plugins: [officialLayout, workspace, sidebar],
    localProviders: [face('@dsh-one/vscode-chat-ui-layout', [], ['layout'])],
  })
  assert.deepEqual(withLocal.blocked, [officialLayout.id])
  assert.deepEqual(withLocal.added, [])
  // 反向对照：不把自有插件当提供方传进去，layout 就被当成没了，连锁挡住两件本来要用的件。
  const withoutLocal = deriveBlockList({ blocked: [officialLayout.id], plugins: [officialLayout, workspace, sidebar] })
  assert.deepEqual(withoutLocal.blocked, [officialLayout.id, workspace.id, sidebar.id])
})

test('只补不删：原有条目与顺序一字不动，补入的跟在后面；对同一份清单再跑一次是空操作', () => {
  const plugins = [CONVERSATION, PLAN, CHAT]
  const input = ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-conversation']
  const first = deriveBlockList({ blocked: input, plugins })
  assert.deepEqual(first.blocked.slice(0, input.length), input)
  const second = deriveBlockList({ blocked: first.blocked, plugins })
  assert.deepEqual(second.blocked, first.blocked)
  assert.deepEqual(second.added, [])
})

test('清单里重复的 id 只留一条，补入的也不重复', () => {
  const { blocked, added } = deriveBlockList({
    blocked: [CONVERSATION.id, CONVERSATION.id, CHAT.id],
    plugins: [CONVERSATION, PLAN, CHAT],
  })
  assert.deepEqual(blocked, [CONVERSATION.id, CHAT.id, PLAN.id])
  assert.deepEqual(
    added.map((a) => a.id),
    [PLAN.id],
  )
})

test('框架/主机层服务（loader / modules / remote.*）没有提供方也不传播', () => {
  assert.deepEqual(FRAMEWORK_SERVICE_NAMES, ['loader', 'modules'])
  assert.deepEqual(FRAMEWORK_SERVICE_PREFIXES, ['remote.'])
  assert.equal(isFrameworkService('remote.session'), true)
  assert.equal(isFrameworkService('loader'), true)
  assert.equal(isFrameworkService('uiConversation'), false)
  const gateway = face('@deepseek-ai/dsh-api-gateway', ['typert', 'connection'], ['remote'])
  const remoteUser = face('@deepseek-ai/dsh-api-session-controller', ['loader', 'modules', 'remote.session'])
  const { blocked, added } = deriveBlockList({ blocked: [gateway.id], plugins: [gateway, remoteUser] })
  // remote.session / loader / modules 都判为「框架层永远在」，所以这一件不连坐。
  assert.deepEqual(blocked, [gateway.id])
  assert.deepEqual(added, [])
})

test('规则算不出来的手写条目：被牵连进来的不算，形态类（挡掉的服务提供方）点得出来', () => {
  const hand = [CONVERSATION.id, PLAN.id]
  // ui-plan 是「被牵连进来的」：把它单独拿掉，补全会因为它等 uiConversation 又补回来。
  // ui-conversation 是「刻意挡掉的服务提供方」：规则不解释它（规则只从挡掉项往外传播）。
  assert.deepEqual(unaccountedBlocks({ blocked: hand, plugins: [CONVERSATION, PLAN, CHAT] }), [CONVERSATION.id])
})

test('取法自检：找不到提供方的服务要能点出来，框架那一族除外', () => {  const renderer = face('@deepseek-ai/dsh-client-ui-renderer', [], ['slots'])
  const unknown = face('@deepseek-ai/dsh-client-ui-newthing', ['slots', 'loader', 'remote.skills', 'brandNewService'])
  assert.deepEqual(unresolvedServices({ plugins: [renderer, unknown] }), ['brandNewService'])
  // 自有插件提供的不算「找不到」。
  assert.deepEqual(
    unresolvedServices({ plugins: [renderer, unknown], localProviders: [face('@dsh-one/x', [], ['brandNewService'])] }),
    [],
  )
})

/**
 * 判据为什么按服务算、不按 `package.json` 的 `dsh.client.inject`（模块 id 表）算——
 * 拿同一份**官方 0.1.6-alpha.2 实测形状**的模型跑两种取法，看结果差多少。
 *
 * 形状（都在真包上核过）：`ui-conversation` 的模块表里列着 `dsh-client-ui-layout`
 * （只用于装载顺序），而它的服务表是 `slots` / `sessions` / `uiConversation`；
 * `ui-plan` 的模块表里列着 `ui-conversation` 与 `ui-chat`，服务表里是 `uiConversation`。
 */
test('取法自检：按模块 id 表做闭包会把对话区与官方侧栏壳一起挡掉，按服务表不会', () => {
  const id = (name: string): string => `@deepseek-ai/${name}`
  const moduleInject: Record<string, string[]> = {
    [id('dsh-client-ui-layout')]: [],
    [id('dsh-client-ui-conversation')]: [id('dsh-client-ui-layout')],
    [id('dsh-client-ui-chat')]: [id('dsh-client-ui-layout'), id('dsh-client-ui-conversation')],
    [id('dsh-client-ui-plan')]: [id('dsh-client-ui-conversation'), id('dsh-client-ui-chat')],
    [id('dsh-client-ui-sidebar')]: [id('dsh-client-ui-layout'), id('dsh-client-ui-conversation')],
  }
  const services: PluginServiceFace[] = [
    face(id('dsh-client-ui-layout'), ['slots', 'theme', 'locale'], ['layout']),
    face(id('dsh-client-ui-conversation'), ['slots', 'sessions', 'uiConversation'], ['conversation', 'uiConversation']),
    face(id('dsh-client-ui-chat'), ['slots', 'uiConversation']),
    face(id('dsh-client-ui-plan'), ['slots', 'uiConversation']),
    face(id('dsh-client-ui-sidebar'), ['slots', 'uiWorkspace']),
  ]
  const chatSeeds = [id('dsh-client-ui-layout'), id('dsh-client-ui-sidebar')]

  // ① 按模块 id 表做闭包（把每个包自己算作它那个模块 id 的提供方）：对话区两件
  // （ui-conversation / ui-chat）与官方侧栏壳都被算成「必须挡」——那三件正好是这两棵树
  // 离不开的，所以这条取法不能用。读数形状与真实三棵树一致（实测 chat 2 → 38、
  // sidebar 13 → 39）。
  const moduleClosure = new Set(chatSeeds)
  for (let changed = true; changed; ) {
    changed = false
    for (const [pkg, deps] of Object.entries(moduleInject)) {
      if (moduleClosure.has(pkg)) continue
      if (deps.some((d) => moduleClosure.has(d))) {
        moduleClosure.add(pkg)
        changed = true
      }
    }
  }
  assert.deepEqual([...moduleClosure], [
    id('dsh-client-ui-layout'),
    id('dsh-client-ui-sidebar'),
    id('dsh-client-ui-conversation'),
    id('dsh-client-ui-chat'),
    id('dsh-client-ui-plan'),
  ])

  // ② 按服务表算：`layout` 由自有 frame 插件顶着（官方件被挡不影响别人），
  // `ui-sidebar` 自己不提供服务——所以一条都不多补。
  const byServices = deriveBlockList({
    blocked: chatSeeds,
    plugins: services,
    localProviders: [face('@dsh-one/vscode-chat-ui-layout', [], ['layout'])],
  })
  assert.deepEqual(byServices.blocked, chatSeeds)
  assert.deepEqual(byServices.added, [])
})

/**
 * #242：profile 里用户自己装的第三方插件（`profilePlugins`）。
 *
 * 判据分两半，两个方向都要钉住：
 *
 * - **只报不挡**：第三方插件等不到服务时**不补进清单**（替用户挡掉 = 静默移除他的插件），
 *   但要由 `unplaceableProfilePlugins` 报得出来——否则这件事离线看不见（#242 的缺口）。
 * - **提供方算数**：第三方插件提供的服务也是真服务，别把它当成「没了」。
 */
const THIRD_PARTY = face('@dsh-external/dsh-lab-third-party', ['slots', 'uiConversation'])

test('第三方插件等不到服务：不补进清单（默认保留），但要报得出 id / 服务 / 被挡的提供方', () => {
  const input = {
    blocked: [CONVERSATION.id],
    plugins: [CONVERSATION, PLAN],
    profilePlugins: [THIRD_PARTY],
  }
  const { blocked, added } = deriveBlockList(input)
  // 官方那件（等 uiConversation 的 ui-plan）照旧补进清单；第三方那件只报不挡。
  assert.deepEqual(blocked, [CONVERSATION.id, PLAN.id])
  assert.deepEqual(
    added.map((a) => a.id),
    [PLAN.id],
  )
  assert.deepEqual(unplaceableProfilePlugins(input), [
    {
      id: THIRD_PARTY.id,
      waitingFor: ['uiConversation'],
      providers: [CONVERSATION.id],
    },
  ])
  // 负向对照（这是 #242 要的那一条）：**不把第三方插件当输入**（= 改前的口径）时，
  // 这件事谁都看不见——它既不进清单，也没有任何地方报它在这棵树里起不来。
  assert.deepEqual(unplaceableProfilePlugins({ blocked: input.blocked, plugins: [CONVERSATION, PLAN] }), [])
})

test('第三方插件在别的树里等得到服务时不报（按树判，不是一票否决）', () => {
  const everyTree = { plugins: [CONVERSATION, PLAN], profilePlugins: [THIRD_PARTY] }
  assert.deepEqual(unplaceableProfilePlugins({ ...everyTree, blocked: [] }), [])
  assert.equal(unplaceableProfilePlugins({ ...everyTree, blocked: [CONVERSATION.id] }).length, 1)
})

test('第三方插件提供的服务算数：官方件不因「官方提供方被挡」连坐，也不再报成「找不到提供方」', () => {
  const officialProvider = face('@deepseek-ai/dsh-client-ui-svc', [], ['svc'])
  const consumer = face('@deepseek-ai/dsh-client-ui-newthing', ['svc'])
  const thirdProvider = face('@dsh-external/dsh-svc-provider', [], ['svc'])
  const withThird = deriveBlockList({
    blocked: [officialProvider.id],
    plugins: [officialProvider, consumer],
    profilePlugins: [thirdProvider],
  })
  assert.deepEqual(withThird.blocked, [officialProvider.id])
  assert.deepEqual(withThird.added, [])
  // 反向对照：不传第三方插件时，规则把消费者一起挡掉（多挡，代价是少加载一件本来该用的官方件）。
  const withoutThird = deriveBlockList({ blocked: [officialProvider.id], plugins: [officialProvider, consumer] })
  assert.deepEqual(withoutThird.blocked, [officialProvider.id, consumer.id])
  // 取法自检那一面同理：只由第三方插件提供的服务不算「找不到提供方」（报出来是假红）。
  assert.deepEqual(unresolvedServices({ plugins: [consumer] }), ['svc'])
  assert.deepEqual(unresolvedServices({ plugins: [consumer], profilePlugins: [thirdProvider] }), [])
})

test('第三方插件等一个谁都不提供的服务：不报「放不下」（静态表看不见宿主半与运行时挂出来的那一族）', () => {
  const needsUnknown = face('@dsh-external/dsh-unknown', ['someHostSideService'])
  assert.deepEqual(
    unplaceableProfilePlugins({ blocked: [], plugins: [CONVERSATION], profilePlugins: [needsUnknown] }),
    [],
  )
})
