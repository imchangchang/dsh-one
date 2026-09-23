/**
 * 按官方「谁提供服务 / 谁等服务」算出每棵树**补全后**的 block list（#227）。
 *
 * ## 要解决的事
 *
 * 2026-09-22 的 alpha.2 事故（#225）：官方 `@deepseek-ai/dsh-client-ui-plan` 在
 * 0.1.6-alpha.2 里开始等 `uiConversation` 服务，而侧栏树把提供这个服务的
 * `@deepseek-ai/dsh-client-ui-conversation` 下线了、**却没下线它** —— 官方启动审计
 * 报 `web boot: 1 entry did not activate`（`ui-plan: pending (waiting for service:
 * uiConversation)`），侧栏页被那张失败卡挡住。手写清单漏掉它，是因为「谁等谁」没人
 * 逐版核过一遍。
 *
 * 规则一句话：**一棵树挡掉的包，凡是等它的 entry 也一起挡掉**（顺着依赖一层层找，
 * 直到不再新增）。只补不删——形态类的下线项（官方外框、官方侧栏这类与版本无关的）
 * 是手写的，照旧留在清单里，本函数算出来的结果叠加在上面。多挡一条的代价是少加载
 * 一个本来也不渲染的 entry；少挡才是上面那起事故。
 *
 * ## 为什么「等」按服务算，不按 `dsh.client.inject` 算
 *
 * 官方包清单里有两个 `inject`，看混就得出反的结论：
 *
 * - `package.json` 的 `dsh.client.inject`（= 网关 wire 里每个 entry 的 `inject`）是
 *   **模块 id** 表，只决定**装载顺序**。按它做闭包会把依赖方一起挡掉，而依赖方并不会
 *   因为对方被挡而不激活：今天的事实是对话区那棵树挡了 `ui-layout`、而
 *   `ui-conversation` 的模块表里就列着 `dsh-client-ui-layout`，对话区照样全绿。
 *   实测按模块表做闭包：chat 2 → 38 条、sidebar 13 → 39 条、settings 14 → 38 条，
 *   多出来的里面有对话区本身与官方侧栏壳——那两样是这两棵树离不开的。
 * - 官方 bundle（`lib/client.js`）导出的 `inject` 是**服务名**表，这个才是启动审计的
 *   判据：缺一个服务，cordis 就停在 `pending (waiting for service: X)`。
 *
 * 所以这里按服务算：一件插件「需要」（`needs`）的是服务名，另一件「提供」（`provides`）
 * 的也是服务名，两边对得上才是真依赖。
 *
 * ## 为什么结果偏保守
 *
 * 「服务的提供方全被挡掉」这件事我们按**静态表**判：同名服务只要还有一个没被挡的
 * 提供方在，这个服务就还在。静态表比运行期少知道两样，两样都往保守的方向偏：
 *
 * - 服务名与服务名之间还有我们没建模的等价关系（如官方的两代 hook 名），表里认不出来
 *   时会把一个还在的服务当成没了，于是多挡一条；
 * - 自有插件顶替官方角色时（三棵树的 frame 插件都 `reflect.provide('layout', …)`，
 *   见 `shell/frameShared.ts`），要由调用方把自有插件当「提供方」一并传进来
 *   （`localProviders`）。漏传会把 `layout` 当成没了，连锁挡掉一片。
 *
 * 偏保守的代价是「少加载一个本来就不渲染的 entry」；反过来（少挡）会让整页 boot
 * 失败，所以这条判据的方向只能是这个。
 *
 * ## 表外的插件：profile 里用户装的第三方插件（#242）
 *
 * 本文档前面说的「表」= 官方内置那批插件。用户的 profile 里还可能有他自己装的第三方插件
 * （`dsh.profile.bundles` 里非 `@deepseek-ai` 的包，例如现场那件 `@changfenhuang/dsh-genui`），
 * 它们**不在这张表里**，处置也**不同**：
 *
 * - **永不被补进清单**（`profilePlugins` 参数）：它们不是我们的件，把它们写进清单等于替用户
 *   把插件从这棵树里静默移除；而少挡的风险（整页 boot 失败）在这里也不适用——挡掉它并不会
 *   让它激活。
 * - **但要被检查**（{@link unplaceableProfilePlugins}）：第三方插件 inject 了本树没有的服务时，
 *   它在这棵树里会停在 `pending (waiting for service: …)`——官方启动审计点名它、页面自愈
 *   把它从本页清单里摘掉（一条日志），一次点名太多条时整页落到失败卡。这件事**原来离线
 *   算不出来**（输入里根本没有它），现在算得出来、报得出去，怎么处置由维护者定。
 * - 它们**提供的**服务照常算数（别把第三方插件提供的服务当成「没了」）。
 */

/** 一件插件的服务面：它等哪些服务、它提供哪些服务。 */
export interface PluginServiceFace {
  id: string
  /** 它需要的服务（官方 bundle 的 `inject` 导出 / 自有插件源码的同名导出）。 */
  needs: readonly string[]
  /** 它提供的服务（官方 bundle 里的 `super(ctx, "X")` / `ctx.reflect.provide("X", …)`）。 */
  provides: readonly string[]
}

/**
 * 框架/主机层服务的名字：官方包表里根本没有提供方，因为它们由运行时或宿主的远端层
 * 提供（`loader` 是模块装载器自己，`modules` 是模块系统的服务，`remote.*` 是官方
 * api-gateway 按宿主能力动态挂出来的那一族）。这一族永远在，不参与「提供方被挡掉」
 * 的传播；除此之外的服务如果在官方包里找不到提供方，说明我们的取法漏了，调用方
 * （探针）要据此报红，不能默默当成「永远在」。
 */
export const FRAMEWORK_SERVICE_NAMES: readonly string[] = ['loader', 'modules']

/** 见 `FRAMEWORK_SERVICE_NAMES`：这一族按前缀认。 */
export const FRAMEWORK_SERVICE_PREFIXES: readonly string[] = ['remote.']

/** 这个服务名是不是框架/主机层提供的。 */
export function isFrameworkService(name: string): boolean {
  return FRAMEWORK_SERVICE_NAMES.includes(name) || FRAMEWORK_SERVICE_PREFIXES.some((p) => name.startsWith(p))
}

/** 补进清单的一条：为什么补它（它等的服务，提供方全被挡掉了）。 */
export interface DerivedBlockAddition {
  id: string
  waitingFor: readonly string[]
  providers: readonly string[]
}

export interface BlockListDerivation {
  /** 补全后的清单：入参原有条目在前、按依赖层次补入的在后，顺序稳定、无重复。 */
  blocked: string[]
  /** 本次补进去的条目（含理由），没补时为 `[]`。 */
  added: readonly DerivedBlockAddition[]
}

/** 补全与检查共用的输入：谁被挡了、表里有哪些插件、表外还有哪些插件。 */
export interface BlockListInput extends PluginFacesInput {
  blocked: readonly string[]
}

/** 表内/表外的插件集合（`BlockListInput` 里除「谁被挡了」之外的那一半）。 */
export interface PluginFacesInput {
  /** 官方各 entry 的服务面（id 用清单里的同一个 id 空间）。 */
  plugins: readonly PluginServiceFace[]
  /**
   * 只贡献「提供方」的非官方插件：三棵树的 frame 插件（顶替官方 `dsh-client-ui-layout`
   * 提供的 `layout`，见 `src/ui/assembly/shell/*LayoutPlugin.ts` 的 `reflect.provide('layout', …)`）。
   */
  localProviders?: readonly PluginServiceFace[]
  /**
   * profile 里用户自己装的第三方插件（`dsh.profile.bundles` 里非官方的那些，#242）。
   *
   * 与 `localProviders` 一样**永不被补进清单**——它们不是我们的件，不该被我们的清单挡掉；
   * 区别是它们要**被检查**：{@link unplaceableProfilePlugins} 点出哪些在这棵树里等不到服务。
   * 提供方那一半照常算数（第三方插件提供的服务也是真服务，别把它当成「没了」）。
   */
  profilePlugins?: readonly PluginServiceFace[]
}

/** 表里所有插件（含表外那些只贡献提供方的）按服务名建索引。 */
function providerMap(input: BlockListInput): Map<string, string[]> {
  const providers = new Map<string, string[]>()
  for (const p of [...input.plugins, ...(input.localProviders ?? []), ...(input.profilePlugins ?? [])]) {
    for (const service of p.provides) {
      const list = providers.get(service)
      if (list === undefined) providers.set(service, [p.id])
      else list.push(p.id)
    }
  }
  return providers
}

/**
 * 一件插件在**这一棵树**里等不到的服务：有提供方、但提供方全被挡掉的那些。
 *
 * 判据只认这一种（`providers.get(service) !== undefined`）。「一个提供方都找不到」的服务
 * 不算——静态表看不见宿主半与运行时挂出来的服务，拿它判会得出假红（见 `isFrameworkService`
 * 与 `unresolvedServices` 的分工）。
 */
function lostServices(face: PluginServiceFace, providers: ReadonlyMap<string, string[]>, blocked: ReadonlySet<string>): string[] {
  return face.needs.filter((service) => {
    const list = providers.get(service)
    return list !== undefined && list.every((id) => blocked.has(id))
  })
}

/**
 * 补全一棵树的 block list。
 *
 * @param input.blocked - 这棵树现有的手写清单（形态类与已核过的服务级条目都在里面）。
 * @param input.plugins - 官方各 entry 的服务面（id 用清单里的同一个 id 空间）；只有它们会被补进清单。
 * @param input.localProviders - 只贡献「提供方」的自有插件（顶替了某个官方包的角色，
 *   例如三棵树各自的 frame 插件提供 `layout`）。它们不会被补进清单——自有插件不下线。
 * @param input.profilePlugins - profile 里用户自己装的第三方插件：同样不会被补进清单，
 *   只贡献提供方，另外由 {@link unplaceableProfilePlugins} 检查（见 {@link BlockListInput}）。
 */
export function deriveBlockList(input: BlockListInput): BlockListDerivation {
  const blocked = new Set(input.blocked)
  const ordered = [...blocked]
  const added: DerivedBlockAddition[] = []
  for (;;) {
    const providers = providerMap(input)

    const round: DerivedBlockAddition[] = []
    for (const p of input.plugins) {
      if (blocked.has(p.id)) continue
      const lost = lostServices(p, providers, blocked)
      if (lost.length === 0) continue
      blocked.add(p.id)
      ordered.push(p.id)
      round.push({
        id: p.id,
        waitingFor: lost,
        providers: [...new Set(lost.flatMap((s) => providers.get(s) ?? []))],
      })
    }
    if (round.length === 0) break
    added.push(...round)
  }
  return { blocked: ordered, added }
}

/**
 * profile 里用户自己装的第三方插件中，**在这棵树里等不到服务**的那几件（#242）。
 *
 * 为什么单独一个函数、不混进 `deriveBlockList` 的 `added`：那两份的**处置**不同。
 * 补进 `added` 的意思是「把它挡掉」，而第三方插件不是我们的件——把它写进清单等于替用户
 * 把他的插件从这棵树里静默移除（运行期那一条还能留下自愈的日志，清单里那一挡什么痕迹都没有）。
 * 所以这里只**报出来**：这些件在这棵树里会停在 `pending (waiting for service: …)`，
 * 官方启动审计会点名它、页面自愈会把它从本页清单里摘掉（一条日志），怎么处置由维护者定
 * ——补上那个服务的提供方（放行官方件）、接受这件插件在这棵树里缺位、或换一棵树。
 *
 * 顺序与去重：入参顺序，同一件只报一次。
 */
export function unplaceableProfilePlugins(input: BlockListInput): DerivedBlockAddition[] {
  const providers = providerMap(input)
  const blocked = new Set(input.blocked)
  const out: DerivedBlockAddition[] = []
  for (const p of input.profilePlugins ?? []) {
    const lost = lostServices(p, providers, blocked)
    if (lost.length === 0) continue
    out.push({ id: p.id, waitingFor: lost, providers: [...new Set(lost.flatMap((s) => providers.get(s) ?? []))] })
  }
  return out
}

/**
 * 手写清单里「服务规则算不出来」的那几条。
 *
 * 判法：把某一条**单独**从清单里拿掉、再跑一遍补全——它不会被补回来，就说明它的存在
 * 不是为了堵某个别人需要的服务（那种条目会被补全原样补回来），而是**形态/角色理由**
 * （官方外框、官方侧栏、设置子页组这类与版本无关的形态类，或被刻意挡掉的服务提供方）。
 *
 * 这些条目**不影响判据**（多挡一条的代价只是少加载一个本来也不渲染的 entry），列出来
 * 只是为了让维护者知道「规则解释得了清单的哪一部分」：规则解释不了的那部分，上游换写法
 * 时得靠人复核。
 */
export function unaccountedBlocks(input: BlockListInput): string[] {
  return input.blocked.filter((id) => {
    const without = input.blocked.filter((x) => x !== id)
    return !deriveBlockList({ ...input, blocked: without }).blocked.includes(id)
  })
}

/**
 * 表里「有插件在等、却找不到任何提供方」的服务（框架/主机层的那一族除外）。
 *
 * 这不是 block list 判据，是**取法自检**：官方换一种写法挂服务（例如不再用
 * `super(ctx, "X")` / `ctx.reflect.provide("X", …)`）时，提供方就抓不到了——那时
 * 这个函数会点出那些服务名，让探针报红而不是把「提供方全被挡掉」判成假。
 *
 * 提供方一侧含 `localProviders` 与 `profilePlugins`：某个服务只由自有插件或用户装的
 * 第三方插件提供时，它就是**有提供方**的（别报成「取法漏了」，那是假红）。
 * 需求一侧只看 `plugins`（官方件）——第三方插件要的服务在不在，由
 * {@link unplaceableProfilePlugins} 按另一条判据回答。
 */
export function unresolvedServices(input: PluginFacesInput): string[] {
  const provided = new Set<string>()
  for (const p of [...input.plugins, ...(input.localProviders ?? []), ...(input.profilePlugins ?? [])]) {
    for (const s of p.provides) provided.add(s)
  }
  const needed = new Set<string>()
  for (const p of input.plugins) for (const s of p.needs) needed.add(s)
  return [...needed].filter((s) => !provided.has(s) && !isFrameworkService(s)).sort()
}
