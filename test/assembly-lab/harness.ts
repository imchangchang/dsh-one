/**
 * 浏览器验证 harness 的公共件（#78）：开页、抓控制台、查槽位、收集断言。
 *
 * 验证套件（suites.ts）只用这里的两样东西：
 * - `openTreePage`：按实验室某棵树的页面开一个干净上下文（新 localStorage、
 *   装了假宿主），等首屏就绪并静置，返回该页的控制台/报错记录；
 * - `Check`：断言收集器——一条断言一处观测，最后折成 ledger 条目。
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { installLabDataset, type DatasetStats, type LabDataset } from './dataset.ts'
import { EN, ZH } from '../../packages/dsh-workspace-tree/src/workspaceTree/locale.ts'
import { fakeHostScript } from './fakeHost.ts'
import { readPageSurface, type PageSurface } from './sessionSurface.ts'
import type { LabServer, LabTreeRoute } from './labServer.ts'

/** 一条断言的结论。 */
export interface Assertion {
  label: string
  ok: boolean
  detail: string
}

/**
 * 一条**文案**断言：把期望值写成插件词典里的那条中文，再按当前页面语言放宽到它对应的
 * 两种取值（zh / en）。
 *
 * 为什么要有它：页面语言是**运行环境的输入**（开发者日常实例是 zh，全新 `DSH_HOME` 的空
 * 实例起来是 en）。断言里写死中文会得到一条「换台机器就红」的假失败（#148 立、#162 普查），
 * 所以期望值一律从词典来：给一条中文文案，这里反查出它的键、把 `{n}` 这类占位抓出来，
 * 再渲染出 zh / en 两份；断言判「实测值等于其中一份」。
 *
 * 判据一个字没放宽：能对上的永远是**同一个键**的那两种语言取值。
 */
/**
 * 官方命名空间的几条（我们的弹窗与官方件自己的控件经官方 `t()` 取，值不归
 * `workspaceTree/locale.ts` 管）：值取自官方词典本身（zh 页 / en 页各实测一次）。
 * 套件判这些文案时同样要两种语言都认。
 *
 * **每条的出处（哪份官方包、哪个键）写在条目上，zh 与 en 都必须是那一版里的真值**：
 * 词典里查不到的东西一律不许写进来（缺一份 = 那一份语言上这条判据静默失效，这正是
 * #208 要堵的那类缺口）。来源都是本机装着的官方包 `@deepseek-ai/dsh@0.1.6-alpha.1`
 * 里的 `lib/client.js`（键名与取值逐字抄自那份产物）。
 *
 * 缺值时的行为（口径）：`OFFICIAL_EXTRA` 里没有的文案，`texts()` 就回到我们自己那份
 * 词典里找；两边都没有时**原样返回一条**（只有中文那一份）——所以**加进这张表的每条都要
 * 给全两份**，不然那一份语言上等于白写。
 *
 * 这张表也是 **#209 那条自检的分档判据**：`test/livenessTextSelectors.test.ts` 按
 * {@link hasOfficialExtra} 断言「官方件那几条确实在这张表里、我们自己的那几条确实不在这张
 * 表里」，并逐条查两份取值都真的落进了选择器。
 */
const OFFICIAL_EXTRA: Readonly<Record<string, readonly [string, string]>> = {
  // 官方内置 `common` 命名空间的 `cancel` 键（我们的弹窗那枚「取消」走的是它）。
  // 出处：`@deepseek-ai/dsh-client-locale` 的 `lib/client.js`。
  取消: ['取消', 'Cancel'],
  // 官方对话区 composer 的几枚（键 `input.commands` / `input.send`）。出处：
  // `@deepseek-ai/dsh-client-ui-conversation` 的 `lib/client.js`。
  '添加文件或调用指令': ['添加文件或调用指令', 'Add files or run commands'],
  发送消息: ['发送消息', 'Send message'],
  // 上下文用量那一枚的 `aria-label`（键 `context.aria`）——**带百分比**的模板，两份语言里占位
  // 的位置还不一样（zh 在句末、en 在句首），所以这里给的是**模板**、不是成品句；选择器怎么按它
  // 拼见 `livenessSuites.ts` 的 `CONTEXT_METER_BUTTON`。（同一件里还有一条 `context.used`
  // = 「上下文已用」/「of context used」，那是展开后那个面板自己的 `aria-label`，探针不点它，
  // 没有收进来。）
  '上下文已用 {percent}': ['上下文已用 {percent}', '{percent} of context used'],
  // 助手动作那枚（键 `action.like`）。出处：`@deepseek-ai/dsh-client-ui-message-feedback` 的 `lib/client.js`。
  好的回答: ['好的回答', 'Good response'],
  // 对话区页签（键 `view.trajectory`）。出处：`@deepseek-ai/dsh-client-ui-trajectory` 的 `lib/client.js`。
  轨迹: ['轨迹', 'Trajectory'],
  // 会话头那枚分裂按钮的标题（键 `open.title`，模板带 `{app}`）。出处：
  // `@deepseek-ai/dsh-client-ui-open-in-app` 的 `lib/client.js`——应用名由那件自己填
  // （`app.finder` 等），所以是**模板**而不是成品句。
  '在 {app} 中打开工作目录': ['在 {app} 中打开工作目录', 'Open workspace in {app}'],
  // 设置页分节导航里官方那一节（键 `general.nav`）。出处：
  // `@deepseek-ai/dsh-client-ui-settings-general` 的 `lib/client.js`。
  通用设置: ['通用设置', 'General'],
  // 权限预设（键 `preset.workspaceWrite`）。出处：
  // `@deepseek-ai/dsh-client-ui-permission-presets` 的 `lib/client.js`。
  工作区内修改: ['工作区内修改', 'Workspace Write'],
  // 官方 ui-theme 的字号步进器（键 `fontSize.increase`）。出处：
  // `@deepseek-ai/dsh-client-ui-theme` 的 `lib/client.js`。
  增大字号: ['增大字号', 'Increase font size'],
  // 语言下拉那枚按钮上显示的是**当前语言用它自己的说法**写的名字，不是词典键：
  // 官方语言目录 `BUILT_IN_LOCALE_METADATA`（`zh.label = "中文"` / `en.label = "English"`，
  // 见其上方注释「The two locales and dictionaries shipped by this package」）。
  // 于是同一个按钮在 zh 页上是「中文」、在 en 页上是「English」——两份都得认。
  // 出处：`@deepseek-ai/dsh-client-locale` 的 `lib/client.js`。
  中文: ['中文', 'English'],
  // #211：官方「新对话页」的两条可见元素（键 `hero.headline` 与 `placeholder.hero`）。
  // 出处：`@deepseek-ai/dsh-client-ui-conversation` 的 `lib/client.js`。
  // 目标会话开不了时对话区该落在这一页上，判据按这两条认（见 chatBootRaceSuites）。
  探索未至之境: ['探索未至之境', 'Into the Unknown'],
  '描述你想要构建的内容, / 调用指令, @ 文件或对话': [
    '描述你想要构建的内容, / 调用指令, @ 文件或对话',
    'Describe what you want to build, / commands, @ files or sessions',
  ],
}

/**
 * 一条中文文案在不在 {@link OFFICIAL_EXTRA} 里（#209 的自检按它判「这条文案归官方件」）。
 *
 * 为什么要有这个口子：`texts()` 把两个来源（我们自己那份词典、官方这张表）汇成同一个结果，
 * 光看返回的两份取值分不出它打哪儿来；而 #209 的自检要按来源分档断言——我们自己的控件走
 * 词典、官方件的标签必须在 `OFFICIAL_EXTRA` 里登记（逐条写着「哪份官方包、哪个键」），
 * 档位张冠李戴（例如把官方那条搬进我们词典、或反过来）同样算红。
 */
export function hasOfficialExtra(zhText: string): boolean {
  return Object.prototype.hasOwnProperty.call(OFFICIAL_EXTRA, zhText)
}

export function texts(zhText: string): string[] {
  const extra = OFFICIAL_EXTRA[zhText]
  if (extra !== undefined) return [...extra]
  for (const [key, template] of Object.entries(ZH)) {
    if (template === zhText) return [zhText, EN[key] ?? zhText]
  }
  // 带占位的那几条：把模板按占位切成字面量段，逐段试「截断到第 i 段」（i = 0,1,2… 个占位）。
  // 这样 `仅显示前 20 条结果` 与只写了前半句的 `仅显示前` 都能对上同一条词典文案，
  // 并渲染出 en 那一份（`Showing the first 20 results` / `Showing the first`）。
  // 逐段要求**整段对上**（不是随便 startsWith），免得像早先那样配到隔壁那条上。
  const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const [key, template] of Object.entries(ZH)) {
    const english = EN[key]
    if (typeof english !== 'string') continue
    const zhParts = template.split(/\{(\w+)\}/)
    const enParts = english.split(/\{(\w+)\}/)
    if (zhParts.length !== enParts.length) continue
    // 模板以占位开头（`{n} 个会话没能移入回收站`、`{n} ago` 这类）时的两条护栏：
    // 首个占位**只认数字**，而且输入必须以数字开头——否则前缀匹配会退化成「随便一段话
    // 只要以某个尾巴结尾就算命中」（早先实测：`仅显示前` 配到了 `{n} 前` 那条上，
    // 渲染出「仅显示 ago」）。
    const leadingNumeric = (zhParts[0] ?? '').length === 0
    for (let placeholders = 0; placeholders * 2 < zhParts.length; placeholders += 1) {
      const zhSegments: string[] = []
      const enSegments: string[] = []
      for (let index = 0; index <= placeholders; index += 1) {
        zhSegments.push(zhParts[index * 2] as string)
        enSegments.push(enParts[index * 2] as string)
      }
      if (placeholders === 0) {
        // 只写了前半句时（`仅显示前` 对 `仅显示前 {n} 条结果…`）连首段末尾的空白一起去掉再比。
        if (zhSegments[0] === zhText) return [zhText, enSegments[0] as string]
        if ((zhSegments[0] ?? '').trimEnd() === zhText) {
          return [zhText, (enSegments[0] ?? '').trimEnd()]
        }
        continue
      }
      const names: string[] = []
      for (let index = 1; index <= placeholders; index += 1) names.push(zhParts[index * 2 - 1] as string)
      if (leadingNumeric && !/^\d/.test(zhText)) continue
      const wildcard = `(${leadingNumeric ? '\\d+' : '.+?'})`
      const pattern = `^${zhSegments.map(escape).join(wildcard)}$`
      const match = new RegExp(pattern, 'u').exec(zhText)
      if (match === null) continue
      const values = Object.fromEntries(names.map((name, index) => [name, match[index + 1] ?? '']))
      const render = (segments: readonly string[]): string =>
        segments.reduce((acc, segment, index) => acc + (index === 0 ? '' : (values[names[index - 1] as string] ?? '')) + segment, '')
      return [render(zhSegments), render(enSegments)]
    }
  }
  // 词典里没有这一条（例如夹具自己起的名字）：原样返回，判据照旧只认这一份。
  return [zhText]
}

/**
 * 一串实测文案里有没有词典里这条（**数组元素逐个等于**它的 zh / en 任一份）。
 *
 * 与 {@link hasText} 的差别：那个判「一段文字里含不含这条」，这个判「这一串条目里有没有
 * 等于这条的那一项」。菜单项清单这类读数是数组，用这个。
 */
export function hasAnyText(actual: readonly (string | null | undefined)[], zhText: string): boolean {
  const allowed = texts(zhText)
  return actual.some((item) => typeof item === 'string' && allowed.includes(item))
}

/**
 * 实测文案**恰好等于**词典里那条（zh / en 任一份）。判据写成「页面文案是『取消置顶』」时用它，
 * 与 {@link texts} 的差别只是这里直接吃实测值、不必自己判 `typeof`。
 */
export function isText(actual: string | null | undefined, zhText: string): boolean {
  return typeof actual === 'string' && texts(zhText).includes(actual)
}

/**
 * 「这段实测文案里含不含词典里那条」（zh / en 任一份含上就算）。
 *
 * 与 {@link texts} 同一件事的另一种用法：判据写成「页面文案里出现『回收站』」时，
 * 期望值同样要从词典来，不能写死中文（理由见 `texts`）。带占位的那几条
 * （`归档整组（2 个会话）`）也会按实测里的数字渲染出 en 那一份再比。
 */
export function hasText(actual: string | null | undefined, zhText: string): boolean {
  const text = typeof actual === 'string' ? actual : ''
  return texts(zhText).some((variant) => text.includes(variant))
}

/** 断言收集器：`ok/eq` 记一条，`fact` 记一个观测值（不计入通过数，写进报告说明）。 */
export class Check {
  private readonly assertions: Assertion[] = []
  private readonly facts: string[] = []

  ok(label: string, condition: boolean, detail?: unknown): boolean {
    this.assertions.push({ label, ok: condition, detail: detail === undefined ? '' : String(detail) })
    return condition
  }

  eq(label: string, actual: unknown, expected: unknown): boolean {
    const same = JSON.stringify(actual) === JSON.stringify(expected)
    return this.ok(label, same, same ? String(actual) : `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`)
  }

  /**
   * 一组文案的逐项比较（见 {@link texts}）：期望写成一串词典里的中文（可以混着不是词典文案的
   * 值，例如图标名 `minus`），实测值逐项等于它的 zh / en 任一份就算过。
   */
  eqTexts(label: string, actual: readonly string[] | undefined, expected: readonly string[]): boolean {
    const list = Array.isArray(actual) ? actual : []
    const same =
      list.length === expected.length &&
      expected.every((want, index) => texts(want).includes(list[index] ?? '\u0000'))
    return this.ok(
      label,
      same,
      same ? JSON.stringify(list) : `actual=${JSON.stringify(list)} expected（每项 zh/en 任一份）=${JSON.stringify(expected)}`,
    )
  }

  /**
   * 文案断言（见 {@link texts}）：`expected` 写成词典里的中文，实测值等于它的 zh / en 任一份
   * 就算过。用它的地方都是「页面把这条文案渲染成什么」这一类的判据。
   */
  eqText(label: string, actual: unknown, expected: string): boolean {
    const allowed = texts(expected)
    const same = allowed.includes(typeof actual === 'string' ? actual : JSON.stringify(actual))
    return this.ok(
      label,
      same,
      same ? String(actual) : `actual=${JSON.stringify(actual)} expected（zh/en 任一份）=${JSON.stringify(allowed)}`,
    )
  }

  /** 只记录观测值（例如「treeitems=17」），不判定。 */
  fact(line: string): void {
    this.facts.push(line)
  }

  get passed(): number {
    return this.assertions.filter((a) => a.ok).length
  }

  get failed(): Assertion[] {
    return this.assertions.filter((a) => !a.ok)
  }

  get total(): number {
    return this.assertions.length
  }

  /** 报告里的「说明」栏：先给结论计数，再给观测值，最后列失败明细。 */
  notes(): string {
    const head = `本套件断言 ${String(this.total)} 条，通过 ${String(this.passed)}。`
    const facts = this.facts.length === 0 ? '' : `\n观测：\n${this.facts.map((f) => `- ${f}`).join('\n')}`
    const failures =
      this.failed.length === 0
        ? ''
        : `\n失败断言：\n${this.failed.map((f) => `- ${f.label}${f.detail === '' ? '' : `（${f.detail}）`}`).join('\n')}`
    return head + facts + failures
  }
}

/**
 * 整轮页面发出的 `/api/<method>` 计数（#177 的信息性观测，同时服务 #175）。
 *
 * 记法：**每一页**开页时听这一页的 `request` 事件（见 `observePageRequests`），把 `/api/`
 * 后面那段路径记一笔。因为是听事件、不是挂路由，**被夹具就地接住的那些也照记**
 * （例如 F-58 拦住 `directoryPicker/pick` 那一条）——所以这份计数是「页面发出去的」，
 * 不是「网关收到的」，报告里按这个口径说。
 */
const apiMethods = new Map<string, number>()

/**
 * 整轮页面发出的请求**落在哪个源**上（`scheme://host:port` → 次数）。
 *
 * 用途：R-06 的「整轮零请求打到实例之外」（#177）——页面上的一切请求都走镜像 /
 * 实验室自己的源，**一条都不该落到本轮实例之外**（尤其不该落到用户日常那台）。
 * 这条是页面侧的读数，与「网关进程只绑了一个地址」那条结构性事实互为佐证。
 */
const apiOrigins = new Map<string, number>()

export function apiMethodCounts(): ReadonlyMap<string, number> {
  return apiMethods
}

export function apiOriginCounts(): ReadonlyMap<string, number> {
  return apiOrigins
}

/**
 * 一条**会打到用户机器**的调用（#175）：实验室连的实例跑在用户这台机器上，网关宿主
 * 收到这几条里的任何一条，后果都出在用户桌面上（访达窗口、系统默认应用、原生目录）。
 * 实例是一次性的，机器不是——所以这几条整轮**一条都不许出现**。
 *
 * 清单来自**读官方源码**（出处逐条写在 {@link NATIVE_SIDE_EFFECT_ROUTES}），不是我方
 * 猜的命名规则。每条的 `path` 是官方源码里的常量逐字照抄。
 */
export interface NativeSideEffectRoute {
  /** 网关上的路径（官方源码里的常量逐字照抄）。 */
  path: string
  /** 为什么会打到用户机器上。 */
  why: string
  /** 官方出处（读过哪个包的哪个文件）。 */
  source: string
}

/**
 * 原生副作用类的那几条路由。
 *
 * **注意第一条不在 `/api/` 下**：官方 `open-in-app` 的启动动作是页面拿 `hostBase()`
 * 裸 fetch 的一个顶层路由（`POST /open-in-app/open`），它不走 connection 的 `/api/<endpoint>`
 * 那条 RPC 通道。只扫 `/api/**` 的观测会把它整个漏掉——而它恰恰是 #163 的现场
 * （每跑一轮整轮在用户桌面上拉起一次访达），所以 `observePageRequests` 把
 * `/api/**` 与这份清单并起来扫。
 *
 * 清单怎么来的：把本机装着的官方 dsh（`@deepseek-ai/dsh@0.1.6-alpha.1`）里
 * 「打开本机东西 / 在真机上起东西」的入口逐个找出来读的——① 全仓扫顶层路由常量
 * （只有 `open-in-app` 这一族是顶层路由，其中 `apps`/`icon` 是读、`open` 才是动作）；
 * ② 逐条读 `dsh-api-*` 各包 `lib/index.js` 里带 `Remote` 装饰器的方法体，看它落到哪个原生动作。
 * 今天一共六条：一条顶层路由 + 五条 remote。
 *
 * 这份清单是**会红的判据**，所以只收「读了源码、确认落到原生动作」的；拿不准的不放进来
 * （宁可它落在报告里「写（新面孔）」那一栏被人看见）。
 * 将来官方新增原生动作时，它要么自己进这份清单，要么由报告里那些新面孔提醒人去核对
 * （见 `verify.ts` 的 R-06）。
 *
 * 命中的请求在页面上会被 `observePageRequests` **拦下来**（`abort`，不往下交），
 * 所以这份清单同时也是「实验室绝不放行到网关」的名单。
 */
export const NATIVE_SIDE_EFFECT_ROUTES: ReadonlyArray<NativeSideEffectRoute> = [
  {
    path: '/open-in-app/open',
    why: '宿主半按 `app` + 工作目录在真机上启动那个应用（macOS 上就是跑 `open <工作目录>`，现场表现是一个访达窗口冒出来）',
    source:
      '官方 `@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js` 的 `OPEN_IN_APP_OPEN_ROUTE`；宿主半 `@deepseek-ai/dsh-host-open-in-app/lib/index.js` 注册同名路由，注释原话「POST route launching one application on one workspace directory」',
  },
  {
    path: '/api/settings/openSettingsDocument',
    why: '网关宿主用**系统默认应用**打开设置文档（原生文本编辑器）',
    source:
      '官方 `@deepseek-ai/dsh-api-settings-controller` 的 remote `settings/openSettingsDocument` → `openNativeTextFile`（`@deepseek-ai/dsh-native-command`）',
  },
  {
    path: '/api/settings/openAgentPresetDirectory',
    why: '网关宿主用原生方式打开 preset 目录（或返回目录路径）',
    source: '同上的 remote `settings/openAgentPresetDirectory` → `openNativePath`',
  },
  {
    path: '/api/session/openWorkspacePath',
    why: '网关宿主在真机上打开（`open`）或显示（`reveal`）一个路径',
    source: '官方 `@deepseek-ai/dsh-api-session-controller` 的 remote `session/openWorkspacePath` → `revealPath` / `openPath`',
  },
  {
    path: '/api/directoryPicker/pick',
    why: '在真机上弹出**原生目录选择器**（macOS 上是 `osascript` 弹的那个选文件夹面板），等用户在桌面上点完才回来',
    source:
      '官方 `@deepseek-ai/dsh-api-workspace-controller` 的 remote `directoryPicker/pick`，方法体第一句就是 `this.requireCapability("native", "pick")`；驱动方 `@deepseek-ai/dsh-host-directory-picker-native/lib/index.js` 在 macOS 分支跑 `osascript`',
  },
  {
    path: '/api/terminal/create',
    why: '在用户机器上**起一个真 shell 进程**（PTY）：官方 `@deepseek-ai/dsh-terminal` 的 `TerminalService.spawn` → `@deepseek-ai/dsh-terminal-bash` 的 `ctx.subprocess.spawnTerminal`，现场表现是机器上多一个真终端',
    source: '官方 `@deepseek-ai/dsh-api-terminal-controller` 的 remote `terminal/create`；后端 `@deepseek-ai/dsh-terminal/lib/index.js`（PTY backend）与 `@deepseek-ai/dsh-terminal-bash/lib/index.js`（`LocalPtySession`）',
  },
]

const NATIVE_SIDE_EFFECT_BY_PATH: ReadonlyMap<string, NativeSideEffectRoute> = new Map(
  NATIVE_SIDE_EFFECT_ROUTES.map((entry) => [entry.path, entry]),
)

/** 整轮观测到的、**没人接住**的原生副作用类调用（一条都不该有；有就整轮红，见 `verify.ts` 的 R-06）。 */
export interface NativeSideEffectCall {
  /** 哪个套件发出来的（`verify.ts` 逐套件设置，见 {@link setLabSuite}）。 */
  suite: string
  /** 套件名（报告里给人认的）。 */
  suiteName: string
  /** 哪一页发出来的（发起那一刻这条页面自己的 URL）。 */
  page: string
  /** 命中的路径。 */
  path: string
  /** 参数摘要（只记键名与值的形状，**字符串值不进报告**，见 {@link summarizeRequestBody}）。 */
  detail: string
}

const observedNativeSideEffectCalls: NativeSideEffectCall[] = []

/** 整轮里**没人接住**的原生副作用类调用（R-06 的判据读它；套件夹具故意接住的不在内）。 */
export function nativeSideEffectCalls(): ReadonlyArray<NativeSideEffectCall> {
  return observedNativeSideEffectCalls
}

/**
 * 当前正在跑的套件（`verify.ts` 每进一个套件设一次，跑完不重置）。
 *
 * 为什么要有它：判据红了要能**指名道姓**——只报「有个套件发了 `open-in-app/open`」等于
 * 没报，得知道是哪个套件、哪一页。#177 那条观测是按页装的、本来拿不到套件号，所以由
 * 整轮的驱动侧（`verify.ts`）在进套件时打一个标记，观测点读它。
 */
let currentSuite: { id: string; name: string } = { id: '（套件之外）', name: '' }

export function setLabSuite(id: string, name: string): void {
  currentSuite = { id, name }
}

/** 一条页面侧的会话面读数（#203）：`where` 指名道姓，`page` 是那次读数（见 sessionSurface.ts）。 */
export interface PageSurfaceReading {
  where: string
  url: string
  page: PageSurface
}

/**
 * 会话面读数的收集器（#203）：**默认没装**（一条都不读）。
 *
 * 装了之后，每次经 `openTreePage` / `openTreePageAlongside` 开好一页都记一条读数，
 * 时间线由装上它的人（`verify.ts` 的 `--diag-surface`）负责攒与落盘。为什么挂在开页
 * 这个既有点上：长轮次里退化的是「整片会话行」，而会话行只在这类页面上量得到——跟着
 * 开页记，既不额外开页、也不额外点任何控件。
 */
export type PageSurfaceSink = (reading: PageSurfaceReading) => void
let pageSurfaceSink: PageSurfaceSink | null = null

export function setPageSurfaceSink(sink: PageSurfaceSink | null): void {
  pageSurfaceSink = sink
}

/** 清空计数（同一进程里跑第二遍时用；`verify.ts` 整轮只跑一遍）。 */
export function resetApiMethodCounts(): void {
  apiMethods.clear()
  apiOrigins.clear()
  observedNativeSideEffectCalls.length = 0
}

/**
 * 为什么观测点装在**页**上而不是上下文上（#175）：上下文那一层挡不住「套件自己
 * `newPage()` 开的页」——官方页（`ctx.lab.gateway + '/'`）、`/official` 页、几个
 * 裸上下文里造的页都不经过 `openTreePage`，而原生副作用恰恰最可能从这些页上发出来。
 * 装在页上之后，**任何**上下文里开出来的**任何**一页都被扫到（`launchBrowser` 把
 * `newContext` / `newPage` 都包了一层，套件照样直接 `browser.newContext()`）。
 *
 * 记的是两类：`/api/**`（整轮的方法清单，报告里那一节；R-06 的「整轮零请求打到实例之外」
 * 也靠这里逐个记源）+ {@link NATIVE_SIDE_EFFECT_ROUTES} 里那几条（不在 `/api/` 下的
 * 顶层路由也在内）。见 `observePageRequests`。
 */

/**
 * 一次调用的**参数摘要**：只记「有哪些键、每个值是什么形状」，**字符串值不进报告**。
 *
 * 为什么必须摘要而不是原样抄：#175 要的是「哪一条调用、带了什么」，而这些调用的参数里
 * 装的正是用户机上的绝对路径（`open` 的工作目录、设置文档路径）。报告是要发出去给人看的，
 * 把用户路径灌进去就成了新的泄露面。所以字符串按「像不像一个裸标识符」分两档：
 * 只有**纯 ASCII 标识符**（应用名 `finder` 这类）原样给，其余一律只给长度。
 * 出处的取值形状（`{app, path}`）见 `dsh-host-open-in-app` 的 `POST /open-in-app/open` 处理段。
 */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    return /^[A-Za-z0-9_.:-]{1,32}$/.test(value) ? value : `<字符串 ${String(value.length)} 字符>`
  }
  if (Array.isArray(value)) return `[${String(value.length)} 项]`
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    return `{${keys.slice(0, 8).join(',')}${keys.length > 8 ? ',…' : ''}}`
  }
  return typeof value
}

function summarizeRequestBody(text: string): string {
  if (text === '') return '（无请求体）'
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return `（请求体 ${String(text.length)} 字节，不是 JSON）`
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return describeValue(parsed)
  const parts: string[] = []
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    // RPC 信封自己的字段（`type` / `rpcId`）：固定形状、不带用户数据，列出来只是噪音。
    if (key === 'type' || key === 'rpcId') continue
    parts.push(`${key}=${describeValue(value)}`)
    if (parts.length >= 8) break
  }
  return parts.length === 0 ? '（无参数）' : parts.join(' ')
}

/**
 * 观测哪一类请求要**拦下来**：{@link NATIVE_SIDE_EFFECT_ROUTES} 里那几条（不在 `/api/`
 * 下的顶层路由也在内）。见 `observePageRequests`。
 */
const NATIVE_ONLY = (url: URL): boolean => NATIVE_SIDE_EFFECT_BY_PATH.has(url.pathname)

/** 已经装过观测的页（页会被 `newPage` 包装与 `context.on('page')` 两路看到，别装两遍）。 */
const observedPages = new WeakSet<Page>()

/**
 * 给一页装观测，两件事分开做（各用各的机制，理由不一样）：
 *
 * **① 方法清单与请求源：听 `request` 事件，不碰请求本身。**
 * 为什么不用 `page.route` + `fallback()`（#177 原来用的就是后者）：几条套件自己在页上挂了
 * 夹具路由（`page.route('**\/api/**', …)`，F-58 就挂着一条 `**\/api/directoryPicker/pick`
 * 用来拦住原生目录面板）。同名路由按**后注册的先跑**，套件那条一定排在观测之后——挂路由装
 * 观测，夹具 `fulfill()` 掉的那些就一条都看不见。`request` 事件在页面发请求那一刻就发，
 * 谁接住、接没接住都照发，所以这份清单没有能被套件盖掉的缝。
 *
 * **② 原生副作用类：挂一条路由把它们拦下来（`abort`，不 `fallback` 下去），没人接住的记一笔。**
 * 这条路由在**装观测那一刻**注册，是这一页上**最早**的那条，所以按「后注册先跑」它跑**最后**
 * ——正好是「套件夹具都没接住」的那一档。两个作用：
 *   - **判据**：走到这一档 = 有一条原生调用真的发出来了，记进 {@link nativeSideEffectCalls}
 *     让 R-06 当场红，并报出套件 / 页面 / 路径 / 参数摘要；
 *   - **兜底**：把它 `abort` 掉，于是**即使**某个套件的夹具写坏了（漏接、或哪天不再 fulfill），
 *     这条调用也到不了网关、用户机器上不会真的冒出东西来。安全由这一层保证，不由套件的自觉
 *     保证——F-58 那条夹具是「故意接住」，不是「唯一的防线」。
 *
 * **只看 POST**：官方那两条通道都只认 POST（`/api/<endpoint>` 的桥
 * `if (request.method !== "POST") return 404`；`open-in-app` 的宿主路由对非 POST 回 405），
 * 非 POST 的同名请求到不了原生动作，拦它、判它红都只会变成假红。
 *
 * **边界**：观测装在每一页上（见 `observeEveryPage`），但只装在**经 `newPage` 开出来的页**
 * 上。今天实验室里没有把 dsh 页面开成弹窗的地方（唯一的弹窗是外链那条路上浏览器自己开的、
 * 套件当场关掉），所以没有留这个口子；将来真要用弹窗装 dsh 页面，这里得跟着补。
 */
async function observePageRequests(page: Page): Promise<void> {
  if (observedPages.has(page)) return
  observedPages.add(page)
  // ① 方法清单 / 请求源（只记，不改请求）。
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/')) return
    const method = decodeURIComponent(url.pathname.slice('/api/'.length)).split('?')[0] ?? ''
    if (method !== '') apiMethods.set(method, (apiMethods.get(method) ?? 0) + 1)
    apiOrigins.set(url.origin, (apiOrigins.get(url.origin) ?? 0) + 1)
  })
  // ② 原生副作用类：拦下来 + 记一笔。
  await page.route(NATIVE_ONLY, async (route) => {
    const request = route.request()
    const known = NATIVE_SIDE_EFFECT_BY_PATH.get(new URL(request.url()).pathname)
    if (known === undefined || request.method() !== 'POST') {
      await route.fallback()
      return
    }
    observedNativeSideEffectCalls.push({
      suite: currentSuite.id,
      suiteName: currentSuite.name,
      page: page.url(),
      path: known.path,
      detail: summarizeRequestBody(request.postData() ?? ''),
    })
    await route.abort('blockedbyclient')
  })
}

/**
 * 把 `Browser` 包一层：**每个 `newContext` 的每个 `newPage` 都装上 {@link observePageRequests}**。
 *
 * 包在 `Browser` 上是唯一能盖住全部页的位置——套件既用 `openTreePage`，也自己
 * `browser.newContext()` / `context.newPage()` 开官方页与裸页（F-54、F-59、F-48、
 * F-47 都各自开页）。观测装完才把页交出去，所以那一页的**第一个**请求就已经在观测里。
 * 方法与属性一律绑回原对象（Playwright 的类用私有字段，`this` 指向 Proxy 会炸）。
 */
function observeEveryPage(browser: Browser): Browser {
  const wrapContext = (context: BrowserContext): BrowserContext =>
    new Proxy(context, {
      get(target, prop) {
        if (prop === 'newPage') {
          return async (...args: unknown[]): Promise<Page> => {
            const method = target.newPage.bind(target) as (...a: unknown[]) => Promise<Page>
            const page = await method(...args)
            await observePageRequests(page)
            return page
          }
        }
        const value = Reflect.get(target, prop) as unknown
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
      },
    }) as BrowserContext
  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async (...args: unknown[]): Promise<BrowserContext> => {
          const method = target.newContext.bind(target) as (...a: unknown[]) => Promise<BrowserContext>
          return wrapContext(await method(...args))
        }
      }
      const value = Reflect.get(target, prop) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  }) as Browser
}

/** 一页的控制台记录（分类靠文本，因为官方不会给错误打标记）。 */
export interface PageCapture {
  consoleErrors: string[]
  consoleWarnings: string[]
  pageErrors: string[]
  /** 全部 console 文本（诊断用，仅在失败时进报告）。 */
  all: string[]
}

/** 官方渲染层的崩溃信号：槽位条目抛错 / 链式选择器抛错。 */
export const CRASH_RE = /slot entry crashed|chain selector crashed/
/** 官方装载层的「契约没满足」信号：条目没激活（缺服务）——页面上会整块报错。 */
export const BOOT_FAIL_RE = /did not activate|waiting for service/

/**
 * 已知噪音白名单：**只**放行与底座契约无关、且另有 issue 跟踪的官方插件噪音。
 * 崩溃（`slot entry crashed`）与装载未激活（`did not activate`）永远不准进这里
 * ——它们就是本套件要抓的底座缺口。每条必须带理由与跟踪 issue，无跟踪的不许进。
 *
 * 现在为空（#74 修完）：唯一那条「设置树 agent-preset 在非活跃上下文读 sessions」
 * 的真因是**我方 settings frame 少声明了官方 root 子槽 `main`**（根因与修法见
 * src/ui/assembly/shell/settingsLayoutPlugin.ts 的 root 注册注释），不是官方件噪音。
 * 留空机制不删：将来真要放行，仍按上面的规矩逐条带理由与 issue 进来。
 */
export const KNOWN_NOISE: ReadonlyArray<{ pattern: RegExp; reason: string }> = []

/** 命中白名单则返回理由（用于报告里如实记录放行了什么）。 */
export function knownNoise(line: string): string | undefined {
  return KNOWN_NOISE.find((entry) => entry.pattern.test(line))?.reason
}

/** 过滤掉已知噪音后的行（报告里同时保留「放行了什么」）。 */
export function withoutKnownNoise(lines: readonly string[]): { real: string[]; noise: string[] } {
  const real: string[] = []
  const noise: string[] = []
  for (const line of lines) {
    if (knownNoise(line) === undefined) real.push(line)
    else noise.push(line)
  }
  return { real, noise }
}


export function capturePage(page: Page): PageCapture {
  const captured: PageCapture = { consoleErrors: [], consoleWarnings: [], pageErrors: [], all: [] }
  page.on('console', (message) => {
    const text = `${message.type()}: ${message.text()}`
    captured.all.push(text)
    if (message.type() === 'error') captured.consoleErrors.push(message.text())
    if (message.type() === 'warning') captured.consoleWarnings.push(message.text())
  })
  page.on('pageerror', (error) => {
    captured.pageErrors.push(error.message)
    captured.all.push(`pageerror: ${error.message}`)
  })
  return captured
}

/** 打开一棵树的页面：干净上下文 + 假宿主 + 等首屏 + 静置。 */
export interface OpenOptions {
  width?: number
  height?: number
  theme?: 'dark' | 'light'
  /** chat 树的启动注入会话 id。 */
  sessionId?: string
  /** 首屏就绪超时（毫秒）。 */
  readyTimeoutMs?: number
  /** 首屏就绪后再静置多久（让异步注册/首帧请求落定）。 */
  settleMs?: number
  /**
   * 抹掉自有 frame 标记（#83 可移植性证据，见 `stripFrameMarkersScript`）：
   * 页面上不存在任何 `data-shell*` 标记，用来实测「插件不靠自有 frame 也工作」。
   */
  stripFrameMarkers?: boolean
  /** 装上 fiber 探针（#91，见 `fiberProbeScript`）：FIBER 套件读它的记录做断言。 */
  fiberProbe?: boolean
  /**
   * 装上 VS Code 链接拦截层的替身（#150，见 `vscodeLinkLayerScript`）：F-48 读它的记录
   * 断言「捕获兜底接管后这一层不再收到同一次点击」（不叠加成双开）。
   */
  linkLayer?: boolean
  /** 假宿主的状态存储初值（键 → 值；#82 的迁移/读写断言用）。 */
  state?: Record<string, unknown>
  /**
   * 点名让哪些宿主调用失败（#110）：假宿主对这些调用一律回
   * `{code:'lab/forced'}` 失败回执——验「动作失败时界面给不给可见反馈」要用真的
   * 失败回执，而不是去造假界面。只作用于 {@link openTreePage} 新建的上下文。
   */
  failCalls?: readonly string[]
  /**
   * 这个假宿主「打开的文件夹」（#112）：`vscode.workspaceFolders` 的回执，缺省空表
   * = 没开任何文件夹（侧栏树按「没有当前工作区」渲染：不显示徽标、不置顶）。场景中途
   * 要换成另一份，用 {@link setLabWorkspaceFolders} 再重载页面。
   */
  workspaceFolders?: readonly string[]
  /**
   * 页内数据集夹具（#162，见 `dataset.ts`）：给这一页喂一份套件自己声明的工作区与会话，
   * 判据就不再吃「这台机器上碰巧有什么数据」。**必须在页面第一次导航之前装**，所以走
   * 这里（`newContext` 之后、`newPage` 之前），套件不用为夹具再重载一次页面。
   *
   * 两条取值（**默认不装**）：
   * - 传一份 `LabDataset`：装这一份——**要夹具数据的套件显式声明**。
   * - 不传（或 `null`）：这一页要真数据（隔离实例里播种的那份，见 `seed.ts`）。
   *
   * #177 之前还有第三条「听这一轮跑法的」（`--empty` 那一轮由 verify.ts 统一装
   * `SIDEBAR_DATASET`）；默认跑法换成隔离实例+播种之后，那条退场了——真数据已经在
   * 实例里，判据不必再吃一份合成数据。
   */
  dataset?: LabDataset | null
}

export interface OpenedPage {
  context: BrowserContext
  page: Page
  capture: PageCapture
  url: string
  /**
   * 这一页装的页内数据集夹具的计数（没装夹具时为 undefined）。套件用它断言
   * 「夹具真的接上了」，而不是把空读数当结论。
   */
  dataset?: DatasetStats
  /** 首屏就绪选择器是否出现（false 时页面很可能整块没起来）。 */
  ready: boolean
}

/**
 * 「页面上没有自有 frame 标记」的页面侧脚本（#83）：把 `data-shell*` 属性的写入
 * 全部拦掉（React 写属性走 `Element.prototype.setAttribute`），属性从来没进过
 * DOM。样式与其余 DOM 一律不动，所以页面照常渲染。
 *
 * 为什么用这个做可移植性证据：官方 web 里本来就没有这个元素，插件若还按
 * `[data-shell="dsh-one"]` 取挂载点，取不到就整块不工作——而这件事在「页面上有
 * 标记」的实验室页面里永远看不出来。抹掉之后仍工作，才说明挂载点在官方语义容器上。
 */
export function stripFrameMarkersScript(): string {
  return `(() => {
  const write = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (String(name).toLowerCase().startsWith("data-shell")) return
    return write.call(this, name, value)
  }
})()`
}

/**
 * VS Code webview 链接拦截层的**替身**（#150）：把 host 在真 webview 里装的那层
 * 「点锚点就交给宿主打开」的监听在实验室页面上重现一份，供套件观察它到底收到了几次点击。
 *
 * 为什么需要替身：这层拦截是**宿主（VS Code）装的**，实验室页面是普通浏览器，跑不出
 * 真 webview 的多层结构（真 webview = 外层文档 + 内层 iframe，监听挂在内层 window 上）。
 * 而 #150 要验的两件事都只有它在场才看得见——①「锚点自己 stopPropagation 就再也到不了
 * 这一层」（真因）；② 我们那层捕获兜底接管之后，这一层**不再收到**同一次点击（不会
 * 与它叠加成双开）。所以按官方源码逐句抄一份最小替身，把「postMessage 给宿主开链接」
 * 换成「记一笔」，其余（`isTrusted` 判据、`composedPath` 找锚点、hash 分支、`preventDefault`）
 * 与官方逐条同形。
 *
 * 出处：VS Code `out/vs/workbench/contrib/webview/browser/pre/index.html` 的
 * `handleInnerClick`（那个文件里它是 `contentWindow.addEventListener('click', handleInnerClick)`，
 * 即**冒泡阶段**、挂在页面 window 上，因此点击路径上一旦有人 `stopPropagation` 它就收不到）。
 * 记录读出走 {@link linkLayerFacts}。
 */
export function vscodeLinkLayerScript(): string {
  return `(() => {
  const record = []
  globalThis.__LAB_VSCODE_LINK_LAYER__ = { record }
  window.addEventListener("click", (event) => {
    if (!event.isTrusted || !event.view || !event.view.document) return
    const baseElement = event.view.document.querySelector("base")
    for (const pathElement of event.composedPath()) {
      const node = pathElement
      if (node.tagName && String(node.tagName).toLowerCase() === "a" && node.href) {
        if (node.getAttribute("href") === "#") {
          event.view.scrollTo(0, 0)
        } else if (node.hash && (node.getAttribute("href") === node.hash || (baseElement && node.href === baseElement.href + node.hash))) {
          const fragment = node.hash.slice(1)
          const decodedFragment = decodeURIComponent(fragment)
          const scrollTarget = event.view.document.getElementById(fragment) ?? event.view.document.getElementById(decodedFragment)
          if (scrollTarget) scrollTarget.scrollIntoView()
          else if (decodedFragment.toLowerCase() === "top") event.view.scrollTo(0, 0)
        } else {
          record.push({ kind: "link", href: node.getAttribute("href"), url: node.href.baseVal || node.href })
        }
        event.preventDefault()
        return
      }
    }
  })
})()`
}

/** 链接拦截层替身收到的点击（{@link vscodeLinkLayerScript}）。 */
export interface LinkLayerFacts {
  /** 每一次「这一层会交给宿主去开」的点击（顺序 = 点击顺序）。 */
  hits: ReadonlyArray<{ kind: string; href: string | null; url: string }>
}

/** 读出链接拦截层替身的记录（没装替身时 hits 为空表）。 */
export async function linkLayerFacts(page: Page): Promise<LinkLayerFacts> {
  const hits = await page.evaluate(() => {
    const layer = (globalThis as { __LAB_VSCODE_LINK_LAYER__?: { record: unknown[] } }).__LAB_VSCODE_LINK_LAYER__
    return (layer?.record ?? []) as { kind: string; href: string | null; url: string }[]
  })
  return { hits }
}

/**
 * 页面侧 fiber 探针（#91）：把每个 cordis scope（fiber）的状态变化记进
 * `globalThis.__LAB_FIBER__`，供套件读出来断言。
 *
 * 为什么必须有它：cordis 插件 fiber 失败（例如 `slot "X" is not declared`）
 * **不进浏览器控制台**——官方 client logger 没有 console exporter（#74 实测首屏
 * console 0 行），整个 scope 静默失败，只能靠派生症状（服务在已失活上下文里被读）
 * 暴露。这类「官方改了槽位名/父子声明就整块不活」的漂移要有自己的断言。
 *
 * 机制（三层，全部走官方既有接口，不改官方代码；@see AGENTS.md 的机制优先序）：
 * 1. 包 `__ModuleLoader__` 的 `load`：每个注册的 factory 包一层，模块 materialize
 *    （factory 执行）时记下 `插件 id → 其 apply 函数` 的映射。用 Proxy 而不是
 *    直接赋值——官方模块系统启动时会**把 facade 的 load 换成自己那份**，只包最初
 *    那个 facade 收不到后续注册。
 * 2. 只给 `@deepseek-ai/dsh-client-modules` 的 apply 包一层，拿它的 ctx：它是页面
 *    第一个跑起来的插件（装配页 facade 自己就按这个 id 找它，见 pageHtml.ts 的
 *    QUEUE_FACADE_JS），所以在**别的 fiber 还没创建之前**就接上事件总线。
 *    **不包别的插件的 apply**：替换 apply 会改掉插件对象的函数身份，官方 loader
 *    认得那个身份——实测（#91 取证）包 `@deepseek-ai/dsh-api-remotes` 的 apply 会让
 *    它挂载的 remote.* 服务全体消失、34 个条目停在 pending。
 * 3. 监听 cordis 事件总线的两个内部事件：`internal/plugin`（fiber 创建时发出，
 *    参数是 fiber，`fiber.runtime.callback` 就是它的插件回调）与 `internal/status`
 *    （状态变化时发出，参数是 fiber + 旧状态）。状态值来自官方 Fiber 的状态枚举：
 *    0 pending / 1 loading / 2 active / 3 FAILED / 4 disposed / 5 unloading。
 *    子 scope（会话级等）的 fiber 回调不在映射里，就沿 `fiber.parent` 往上找有主的
 *    那一层——#74 那条失败正是 ui-agent-preset 的**会话级** scope。
 */
export function fiberProbeScript(): string {
  return `(() => {
  const MODULES_ID = "@deepseek-ai/dsh-client-modules"
  const STATE = { 0: "pending", 1: "loading", 2: "active", 3: "failed", 4: "disposed", 5: "unloading" }
  const record = { plugins: {}, attached: 0, events: 0, scopes: [], failed: [], errors: [], ctx: undefined }
  globalThis.__LAB_FIBER__ = record
  const idsByCallback = new WeakMap()
  const idsByFiber = new Map()
  const seenBuses = new WeakSet()
  const stateOf = (value) => STATE[value] ?? String(value)
  const attach = (ctx) => {
    // #201: keep the ctx itself for the suites (this probe exists only when a suite asks
    // for it). The suites reach the official root-slot publication point through it and
    // inject a real assembly failure (see assemblyFailureSuites.ts). The ctx is stored
    // as-is and no service is resolved here: this attaches very early (the modules plugin
    // apply), before the slots service is registered, and resolving an undeclared service
    // on a ctx without inject throws (that is what the suites work around with
    // ctx.reflect.get).
    if (record.ctx === undefined && ctx !== undefined && ctx !== null) record.ctx = ctx
    const service = ctx === undefined || ctx === null ? undefined : ctx.events
    const bus = service !== undefined && typeof service.on === "function" ? service : ctx
    if (bus === undefined || bus === null || typeof bus.on !== "function" || seenBuses.has(bus)) return
    seenBuses.add(bus)
    record.attached += 1
    bus.on("internal/plugin", (fiber) => {
      try {
        const callback = fiber && fiber.runtime ? fiber.runtime.callback : undefined
        const plugin = callback === undefined ? undefined : idsByCallback.get(callback)
        if (plugin !== undefined) idsByFiber.set(fiber.uid, plugin)
      } catch (err) {
        if (record.errors.length < 20) record.errors.push("plugin: " + String(err))
      }
    })
    bus.on("internal/status", (fiber, previous) => {
      try {
        if (fiber === undefined || fiber === null) return
        record.events += 1
        let plugin
        let owner = fiber
        while (owner !== undefined && owner !== null && plugin === undefined) {
          plugin = idsByFiber.get(owner.uid)
          const parentCtx = owner.parent
          const parentFiber = parentCtx === undefined || parentCtx === null ? undefined : parentCtx.fiber
          if (parentFiber === undefined || parentFiber === null || parentFiber === owner) break
          owner = parentFiber
        }
        let name = ""
        try { if (typeof fiber.name === "string") name = fiber.name } catch (ignored) {}
        const entry = {
          uid: fiber.uid,
          plugin: plugin ?? null,
          name,
          state: stateOf(fiber.state),
          prev: stateOf(previous),
          error: String((fiber._error && fiber._error.message) || ""),
        }
        if (record.scopes.length < 4000) record.scopes.push(entry)
        if (entry.state === "failed" && record.failed.length < 40) record.failed.push(entry)
      } catch (err) {
        if (record.errors.length < 20) record.errors.push("status: " + String(err))
      }
    })
  }
  const register = (exports, id) => {
    record.plugins[id] = true
    if (typeof exports === "function") idsByCallback.set(exports, id)
    else if (exports !== null && typeof exports === "object") {
      if (typeof exports.apply === "function") idsByCallback.set(exports.apply, id)
      const fallback = exports.default
      if (fallback !== undefined && fallback !== null && typeof fallback.apply === "function") idsByCallback.set(fallback.apply, id)
    }
  }
  const wrapLoad = (entry) => {
    if (typeof entry !== "function" || entry.__labWrapped === true) return entry
    const original = entry
    const wrapped = function (registration) {
      if (registration !== null && typeof registration === "object" && typeof registration.factory === "function") {
        const id = registration.id ?? registration.name ?? "?"
        const factory = registration.factory
        registration.factory = function () {
          const exports = factory.apply(this, arguments)
          try {
            register(exports, id)
            if (id === MODULES_ID && exports !== null && typeof exports === "object" && typeof exports.apply === "function") {
              const apply = exports.apply
              exports.apply = function (ctx) {
                attach(ctx)
                return apply.apply(this, arguments)
              }
            }
          } catch (err) {
            if (record.errors.length < 20) record.errors.push("register " + id + ": " + String(err))
          }
          return exports
        }
      }
      return original.apply(this, arguments)
    }
    wrapped.__labWrapped = true
    return wrapped
  }
  const proxies = new WeakMap()
  const proxyFor = (target) => {
    if (target === null || typeof target !== "object") return target
    const cached = proxies.get(target)
    if (cached !== undefined) return cached
    const proxy = new Proxy(target, {
      get(t, prop) {
        const value = Reflect.get(t, prop, t)
        return prop === "load" && typeof value === "function" ? wrapLoad(value) : value
      },
      set(t, prop, value) {
        return Reflect.set(t, prop, prop === "load" && typeof value === "function" ? wrapLoad(value) : value, t)
      },
      defineProperty(t, prop, descriptor) {
        if (prop === "load" && typeof descriptor.value === "function") descriptor.value = wrapLoad(descriptor.value)
        return Reflect.defineProperty(t, prop, descriptor)
      },
    })
    proxies.set(target, proxy)
    return proxy
  }
  let current
  Object.defineProperty(globalThis, "__ModuleLoader__", {
    configurable: true,
    get() { return current === undefined ? undefined : proxyFor(current) },
    set(value) { current = value },
  })
})()`
}

/** fiber 探针记下的一处状态变化（`state`/`prev` 是官方 Fiber 状态枚举的名字）。 */
export interface FiberScopeFact {
  uid: number
  /** 这个 scope 属于哪个插件 id（子 scope 沿 parent 找到有主的那层；找不到为 null）。 */
  plugin: string | null
  name: string
  state: string
  prev: string
  error: string
}

export interface FiberProbeFacts {
  /** 探针登记到的插件 id（模块 materialize 时记下）。 */
  plugins: string[]
  /** 接上的 cordis 事件总线条数（0 = 探针没生效，断言会是空的）。 */
  attached: number
  /** 收到的 `internal/status` 事件数。 */
  events: number
  scopes: FiberScopeFact[]
  failed: FiberScopeFact[]
  /** 探针自身抛过的异常（非空说明记录可能不全，别把「零失败」当结论）。 */
  errors: string[]
}

/** 读出页面上的 fiber 探针记录（没装探针时返回 null）。 */
export async function fiberFacts(page: Page): Promise<FiberProbeFacts | null> {
  const raw = await page.evaluate(() => {
    const record = (globalThis as { __LAB_FIBER__?: unknown }).__LAB_FIBER__
    if (record === undefined) return null
    const typed = record as {
      plugins: Record<string, boolean>
      attached: number
      events: number
      scopes: FiberScopeFact[]
      failed: FiberScopeFact[]
      errors: string[]
    }
    return { ...typed, plugins: Object.keys(typed.plugins) }
  })
  return raw
}

export async function openTreePage(
  browser: Browser,
  lab: LabServer,
  route: LabTreeRoute,
  options: OpenOptions = {},
): Promise<OpenedPage> {
  const context = await browser.newContext({
    viewport: { width: options.width ?? 1200, height: options.height ?? 900 },
    deviceScaleFactor: 2,
  })
  await context.addInitScript({
    content: fakeHostScript(options.state ?? {}, options.failCalls ?? [], options.workspaceFolders ?? []),
  })
  // 数据集夹具（#162）：装在这个上下文上、在第一次导航之前，首帧基线就已是夹具那一份。
  // 只有套件**显式声明**时才装（#177 起不再有「整轮统一装一份」那档：默认跑法连的
  // 隔离实例里已经有播种好的真数据，套件按真数据写）。
  const dataset = options.dataset ?? undefined
  const datasetStats = dataset === undefined ? undefined : await installLabDataset(context, dataset)
  return await openPageIn(lab, route, context, options, datasetStats)
}

/**
 * 把假宿主的「打开的文件夹」换成另一份（#112 的场景切换：空表 / 命中 / 多根 / 没命中）。
 *
 * 为什么必须重载页面才生效：这份表在页面挂载时经能力口读一次（读回前按「没有当前工作区」
 * 渲染），而初始化脚本每次导航都会重跑、把值重置回当初注入的那份。所以套件写第二份时
 * **另装一条初始化脚本**（后装的覆盖先装的），再重载页面——页面重挂载时读到的就是新的。
 */
export async function setLabWorkspaceFolders(context: BrowserContext, paths: readonly string[]): Promise<void> {
  await context.addInitScript({
    content: `(() => { globalThis.__LAB_HOST__.workspaceFolders = ${JSON.stringify([...paths])} })()`,
  })
}

/**
 * 在同一浏览器上下文（= 同一源、同一 localStorage）里再开一个装配页。
 *
 * 为什么需要它：真 VS Code 里多条 webview 同源、localStorage 共享——#71 的 spike
 * 实证多 tab 会互相覆盖官方恢复键（`dsh.sessions.current`），多开通道的启动注入
 * 正是为这个现场设计的。分上下文的开页（{@link openTreePage}）造不出这个现场，
 * 这一档断言（多开 tab 互不串）必须走这条。
 *
 * 注意：调用方关闭返回页时**只能关这个 page**，不能关 context（那会把先前那条
 * 页面一起关掉）——`context.close()` 由上下文的首个页面持有者负责。
 */
export async function openTreePageAlongside(
  existing: OpenedPage,
  lab: LabServer,
  route: LabTreeRoute,
  options: OpenOptions = {},
): Promise<OpenedPage> {
  return await openPageIn(lab, route, existing.context, options)
}

/** 在一个给定上下文里开页并等就绪（两个入口的共用体）。 */
async function openPageIn(
  lab: LabServer,
  route: LabTreeRoute,
  context: BrowserContext,
  options: OpenOptions,
  datasetStats?: DatasetStats,
): Promise<OpenedPage> {
  // 抹自有 frame 标记（#83）：两处入口都认这个开关，且必须在建页之前装——
  // 页面任何脚本执行前生效，属性才从来没进过 DOM。（假宿主由上下文持有者
  // 在 `newContext` 之后统一装，同源的后续页面自然继承，不重复装。）
  if (options.stripFrameMarkers === true) await context.addInitScript({ content: stripFrameMarkersScript() })
  // fiber 探针（#91）同理：必须早于页面任何脚本，才包得住 `__ModuleLoader__`
  // 的第一次赋值（facade）。
  if (options.fiberProbe === true) await context.addInitScript({ content: fiberProbeScript() })
  // 链接拦截层替身（#150）同一条道理：替身要早于页面任何脚本挂上，才对应真 webview
  // 里「外层文档先于页面内容装好监听」的位置。
  if (options.linkLayer === true) await context.addInitScript({ content: vscodeLinkLayerScript() })
  // 请求观测（#177 的方法清单 + #175 的原生副作用守卫）不在这里装：它包在 `Browser`
  // 那一层（见 `observeEveryPage`），`newPage()` 返回之前就已经装好，所以这里只管开页。
  const page = await context.newPage()
  const capture = capturePage(page)
  const query = new URLSearchParams()
  if (options.theme === 'light') query.set('theme', 'light')
  if (options.sessionId !== undefined && options.sessionId !== '') query.set('session', options.sessionId)
  const suffix = query.toString() === '' ? '' : `?${query.toString()}`
  const url = `${lab.origin}/${route.route}${suffix}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  let ready = true
  try {
    await page.waitForSelector(route.readySelector, { timeout: options.readyTimeoutMs ?? 40_000 })
  } catch {
    ready = false
  }
  await page.waitForTimeout(options.settleMs ?? 2_500)
  // 会话面读数（#203）：一页开好、静置完之后顺手记一条（自有树的会话行数 + 这一页到此刻
  // 为止的「服务不可用」控制台行）。**只有装了收集器才读**（`--diag-surface`），默认这条
  // 分支根本不进——默认跑法的行为与 #203 之前逐字相同。
  if (pageSurfaceSink !== null) {
    try {
      const surface = await readPageSurface(page, capture.all)
      pageSurfaceSink({ where: `${currentSuite.id}/${route.route}`, url, page: surface })
    } catch (err) {
      // 读数只是诊断，读不到不该让套件红（页面可能已被套件自己关掉）。
      process.stderr.write(`test/assembly-lab: 会话面读数失败（${route.route}）：${err instanceof Error ? err.message : String(err)}\n`)
    }
  }
  return { context, page, capture, url, ready, ...(datasetStats === undefined ? {} : { dataset: datasetStats }) }
}

export interface SlotFact {
  key: string
  children: number
}

/** 页面上所有槽位锚点的子元素数 + 崩溃标记（`data-slot-error`）。 */
export async function slotFacts(page: Page): Promise<{ slots: SlotFact[]; errors: string[] }> {
  return page.evaluate(() => {
    const slots = Array.from(document.querySelectorAll('[data-slot]')).map((element) => ({
      key: element.getAttribute('data-slot') ?? '',
      children: element.children.length,
    }))
    const errors = Array.from(document.querySelectorAll('[data-slot-error]')).map(
      (element) => element.getAttribute('data-slot-error') ?? '',
    )
    return { slots, errors }
  })
}

/**
 * 槽位锚点的子元素数：`key` 是**完整槽位名**（如 `main`、`main.conversation`、
 * `conversation.composer.bar`）。给了 `outer` 就先定位外层锚点，再在外层之内找
 * `key`——用来断言嵌套槽位的从属关系。找不到返回 -1。
 */
export async function slotChildren(page: Page, key: string, outer?: string): Promise<number> {
  return page.evaluate(
    ({ slotKey, outerKey }) => {
      const scope: Element | null =
        outerKey === null ? document.body : document.querySelector(`[data-slot="${outerKey}"]`)
      const found: Element | null = scope === null ? null : scope.querySelector(`[data-slot="${slotKey}"]`)
      return found === null ? -1 : found.children.length
    },
    { slotKey: key, outerKey: outer ?? null },
  )
}

/** 页面可见文本（诊断/内容断言用，先压缩空白）。 */
export async function bodyText(page: Page): Promise<string> {
  const text = await page.evaluate(() => document.body.innerText)
  return text.replace(/\s+/g, ' ').trim()
}

/** 本次运行里页面上出现过的「契约缺口」文案（崩溃/未激活），失败时写进报告。 */
export function contractGaps(
  capture: PageCapture,
  extraErrors: readonly string[] = [],
): { crashes: string[]; bootFails: string[]; pageErrors: string[]; noise: string[] } {
  const errors = withoutKnownNoise([...capture.pageErrors, ...extraErrors])
  const lines = [...capture.consoleErrors, ...capture.consoleWarnings, ...capture.pageErrors, ...extraErrors]
  return {
    crashes: lines.filter((line) => CRASH_RE.test(line)),
    bootFails: lines.filter((line) => BOOT_FAIL_RE.test(line)),
    pageErrors: errors.real,
    noise: errors.noise,
  }
}

/** 造一个 headless（或带界面）的 chromium。 */
export async function launchBrowser(headless = true): Promise<Browser> {
  // `handleSIGINT` / `handleSIGTERM` 交给**我们自己的**信号处理（`verify.ts` 的 `onSignal`）：
  // Playwright 默认会自己装一对，收到 SIGINT 就关掉浏览器然后 `process.exit(130)`——
  // 于是我们的收尾（关实验室服务器、**按 PID 收掉隔离实例**、删临时 DSH_HOME）刚走到
  // `browser.close()` 就被它带走了：进程按 130 退出，隔离实例与临时目录留在原地
  // （#177 实测：Ctrl-C 之后 `dsh web` 还在监听、`dsh-lab-home-*` 还在）。关浏览器的
  // 责任本来就在我们的收尾里，这里只需把它的默认行为关掉。
  // 观测（#175）在这里装：整轮拿到的 `Browser` 已经把 `newContext` / `newPage` 包了一层，
  // 于是**任何**上下文、**任何**页面上发出的请求都进观测（见 `observeEveryPage`）。
  return observeEveryPage(await chromium.launch({ headless, handleSIGINT: false, handleSIGTERM: false }))
}

/**
 * 等 fiber 状态**静下来**再下结论（F-10 / F-55 共用）。
 *
 * 为什么不能只睡一个固定时长：失败发生在会话级 scope 创建那一刻（#74 那条就是），
 * 而那一刻取决于会话数据什么时候到——睡短了会漏，睡长了每棵树白等。这里改成看
 * `internal/status` 事件的增长：连续 `quietMs` 没有新事件就当这棵树装完了，
 * 上限 `maxMs` 兜底（跑着的会话会持续推流，不能无限等）。
 */
export async function waitForFiberQuiet(
  page: Page,
  check: Check,
  label: string,
  options: { quietMs?: number; maxMs?: number } = {},
): Promise<FiberProbeFacts> {
  const quietMs = options.quietMs ?? 1500
  const maxMs = options.maxMs ?? 15_000
  const started = Date.now()
  let facts = await fiberFacts(page)
  let lastEvents = facts?.events ?? -1
  let quietSince = Date.now()
  while (Date.now() - started < maxMs) {
    await page.waitForTimeout(250)
    const next = await fiberFacts(page)
    if (next === null) break
    facts = next
    if (next.events !== lastEvents) {
      lastEvents = next.events
      quietSince = Date.now()
      continue
    }
    if (Date.now() - quietSince >= quietMs) break
  }
  check.fact(`${label}：fiber 探针等待 ${String(Date.now() - started)}ms 后静下来（事件数 ${String(facts?.events ?? -1)}）`)
  if (facts === null) throw new Error(`${label}: fiber 探针没装上（页面里没有 __LAB_FIBER__）`)
  return facts
}

/** 一条失败 scope 的人话描述（失败信息里直接点名插件、状态与原因）。 */
export function describeFiberFailure(fact: FiberScopeFact): string {
  const who = fact.plugin ?? `无主 scope（uid=${String(fact.uid)}${fact.name === '' ? '' : `, name=${fact.name}`}）`
  return `${who}: ${fact.error === '' ? `状态 ${fact.prev} → ${fact.state}` : fact.error}`
}

/** 各状态的 scope 数（报告里的观测行用）。 */
export function fiberStateCounts(facts: FiberProbeFacts): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const scope of facts.scopes) counts[scope.state] = (counts[scope.state] ?? 0) + 1
  return counts
}

// ---------------------------------------------------------------------------
// 夹具：页面与网关之间那条 mux WebSocket 上的官方转发事件（`$events`）
// ---------------------------------------------------------------------------

/**
 * 官方转发事件流在 mux 上的端点名（`dsh-api-gateway` 客户端的一个常量）。
 *
 * 这一段夹具（注入器 + 等就绪 + 帧构造）原来长在 F-43（`pendingDotSuites.ts`）里，
 * #145 的 F-47 要用同一条通道投另一种帧（`api-session/error`），所以搬进 harness——
 * 两个套件共用一份，免得两处各写一遍代理再各自漂移。
 */
const EVENT_STREAM_ENDPOINT = '$events'

export interface EventStreamInjector {
  /** 投一帧（未就绪就排队，`$events` 流就绪后按序发出）。 */
  push(frame: Record<string, unknown>): void
  /** 观测：见过几条连接、就绪几条、已投出几帧、还排着几帧、见过的端点名。 */
  stats(): { connections: number; ready: number; sent: number; queued: number; endpoints: string[] }
}

/**
 * 装官方转发事件的注入夹具（页面侧 WebSocket 代理）。
 *
 * 两件必须做对的事，都是实测撞出来的：
 * - **mux 信封**：页面那条 socket 上跑的是**多条逻辑流**，服务端写给页面的每条消息都是
 *   `{type:"item", streamId, value}`（`dsh-api-gateway` 客户端的 `parseRemoteStreamServerMessage`
 *   只认这个形状，值直接放在顶层会被判成非法帧、整条 socket 当场断掉重连）。
 * - **ready 先到页面**：客户端把 `$events` 流的**第一个**值当 ready 解析，排队中的帧抢在
 *   前面会让整条流报废。所以帧先排队，见到 `$events` 的 ready 再放。
 *
 * 另外页面**不是一条 socket**：`session/control` / `workspace/follow` / `$events` /
 * `session/follow` 各一条（实测四条），所以注入必须认准「打开过 `$events` 的那条连接
 * 与那个 streamId」，不能图省事发给最近一条。
 */
export async function installEventStreamInjector(page: Page): Promise<EventStreamInjector> {
  interface Connection {
    send(message: string): void
    ready: boolean
    queue: string[]
    /** 这条连接上 `$events` 流的 id（它自己开的那条逻辑流）。 */
    streamId?: string
  }
  const connections: Connection[] = []
  let events: Connection | undefined
  const endpointsSeen = new Set<string>()
  let sent = 0
  await page.routeWebSocket(/remote\.mux/, (socket) => {
    const upstream = socket.connectToServer()
    const endpoints = new Map<string, string>()
    const connection: Connection = {
      send: (message) => {
        socket.send(message)
      },
      ready: false,
      queue: [],
    }
    connections.push(connection)
    socket.onMessage((message) => {
      try {
        const frame = JSON.parse(String(message)) as { type?: string; streamId?: string; endpoint?: string }
        if (frame.type === 'open' && frame.streamId !== undefined && frame.endpoint !== undefined) {
          endpoints.set(frame.streamId, frame.endpoint)
          endpointsSeen.add(frame.endpoint)
          if (frame.endpoint === EVENT_STREAM_ENDPOINT) {
            connection.streamId = frame.streamId
            events = connection
          }
        }
      } catch {
        /* 客户端帧形状变了就原样转发，夹具自身不参与协议解读 */
      }
      upstream.send(message)
    })
    upstream.onMessage((message) => {
      const text = String(message)
      let frame: { type?: string; streamId?: string; value?: { type?: string } } | undefined
      try {
        frame = JSON.parse(text) as typeof frame
      } catch {
        frame = undefined
      }
      const endpoint = frame?.streamId === undefined ? undefined : endpoints.get(frame.streamId)
      if (endpoint === EVENT_STREAM_ENDPOINT && frame?.type === 'item' && frame.value?.type === 'ready' && !connection.ready) {
        socket.send(message)
        connection.ready = true
        for (const queued of connection.queue.splice(0)) {
          connection.send(queued)
          sent += 1
        }
        return
      }
      socket.send(message)
    })
  })
  return {
    push(frame) {
      const target = events
      const text = JSON.stringify({ type: 'item', streamId: target?.streamId, value: frame })
      if (target !== undefined && target.ready) {
        target.send(text)
        sent += 1
        return
      }
      target?.queue.push(text)
    },
    stats: () => ({
      connections: connections.length,
      ready: events !== undefined && events.ready ? 1 : 0,
      sent,
      queued: events?.queue.length ?? 0,
      endpoints: [...endpointsSeen],
    }),
  }
}

/** 等 `$events` 流就绪（页面的官方客户端连上网关并收到 ready 帧）。 */
export async function waitForEventStream(injector: EventStreamInjector, page: Page, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stats = injector.stats()
    if (stats.ready > 0 && stats.queued === 0) return true
    await page.waitForTimeout(150)
  }
  return false
}

/** 一帧官方 `$events` 流上的广播事件（会话状态推进用）。 */
export function emit(event: string, args: unknown[]): Record<string, unknown> {
  return { type: 'emit', event, args }
}
