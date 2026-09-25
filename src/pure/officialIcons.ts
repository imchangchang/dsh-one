/**
 * 官方图标导出名的两代分叉（#236）——单一事实源 + 运行时解析。
 *
 * ## 出了什么事
 *
 * 自有插件从 `@deepseek-ai/dsh-client-ui-primitives` 取图标件。官方在
 * **0.1.7-alpha.2** 把这套图标的导出名整批换了一代写法：
 *
 * - **0.1.6-alpha.2 及以前**：名字带**尺寸后缀**（`IconCloseFill14` / `IconArchiveOutline20`），
 *   每枚图标一个尺寸档；
 * - **0.1.7-alpha.2 起**：名字带**档位后缀**（`IconCloseFillMedium` / `IconCloseFillRegular`），
 *   同一枚图标给两档，两档的**画法完全相同**，只差描边粗细——`Medium` 是 1.3px
 *   （官方导出 `ICON_MEDIUM_STROKE = 1.3`）、`Regular` 是 1px（`ICON_REGULAR_STROKE = 1`）。
 *
 * 这一版**不只是改名**：官方把这套图标整个重画了一遍（视框归一、改成描边画法、部分图形改了
 * 形状——垃圾桶从 1 条实心 path 变成 5 条描边 path，chevron 的视框从 14 变 16）。所以两代之间
 * 能对上的只有「是哪一枚图标」，渲染出来的字节不一样——实验室里凡是按 0.1.6 的 path@d / path
 * 条数当指纹的判据，在 0.1.7 上会红（F-20 / F-32 那几条），那是判据钉在旧形状上，与本文件无关。
 *
 * 两代的图标名**互不重叠**：把 0.1.6-alpha.2 与 0.1.7-alpha.2 的
 * `lib/index.js` 导出表逐名对比，老的一代 81 枚图标全是尺寸后缀，新的一代 184 枚全是档位
 * 后缀，交集 0。而模块加载器按名字取导出，取不到不报错、只是 `undefined`，于是渲染时才炸成
 * React #130（元素类型是 `undefined`）——这就是 #236 的现象：四棵树里凡是用到自有插件的槽位
 * 整片崩。所以这份表的作用是：**把两代名字放在一处，运行时挑在场的那一个；两个都不在场时
 * 当场抛错**，别让 `undefined` 悄悄流到渲染。
 *
 * ## 这 27 组对应关系是怎么定的（不是猜的）
 *
 * 三条互相独立的证据，逐枚核过（量法见下面的「线宽怎么量的」）：
 *
 * 1. **名字一一对应**：老一代的每一枚 `IconX<尺寸>`，在新一代里恰好有一对
 *    `IconX Medium` / `IconX Regular`，字干逐字相同（`IconArchiveOutline20` ↔
 *    `IconArchiveOutlineMedium` / `IconArchiveOutlineRegular`）。27 组的字干全部对得上，
 *    没有第二个候选、也没有一对多。
 * 2. **新一代的默认渲染尺寸 = 老一代的尺寸后缀**：新一代的图形件（`IconXxxArtwork`）都带
 *    `size = <数字>`，那串数字与老一代名字里的后缀**逐枚相等**（`IconCloseFill` 的图形件
 *    `size = 14`、老名是 `IconCloseFill14`；`IconArchiveOutline` 的是 `size = 20`、老名是
 *    `IconArchiveOutline20`）。27 组全部相等——这是「同一枚图标」最硬的一条证据，说明官方只是
 *    把名字里的那一档尺寸挪进了默认值，图标本身没换人。
 *    **第 27 枚（#252 加的那一枚「插件」）比这一条还硬**：两代的图**画数据逐字相同**——
 *    0.1.6-alpha.2 的 `IconPluginPinwheelOutline16` 与 0.1.7-alpha.2 的
 *    `IconPluginPinwheelOutline` 图形件都是同一个 16×16 视框下的那四条 path（`d` 逐字相等），
 *    0.1.6 是每条写死 `stroke-width: 1.2`，0.1.7 改成按档位给描边粗细（`Regular` = 1、
 *    `Medium` = 1.3）。也就是说这一枚两代之间**只有名字与档位写法变了，画的图一个字节没动**。
 * 3. **官方自家插件代码的取用**（`@deepseek-ai/dsh-client-ui-*` 各包 0.1.7-alpha.2 的
 *    `lib/client.js`）：27 枚里有 19 枚被官方插件自己用到，**19 枚全取 `Regular`**（第 19 枚
 *    就是 #252 那一枚：`dsh-client-ui-plugin-manager` 的 `PluginsPanelIcon` 在 0.1.7-alpha.2
 *    取 `IconPluginPinwheelOutlineRegular`）；官方插件
 *    代码里用 `Medium` 的只有两处，都在 14px——输入框那枚加号（`IconPlusOutlineMedium, { size: 14 }`）
 *    与侧栏宽形态的「新会话」（`IconNewChatOutlineMedium, { size: 14 }`）。我们这 27 枚在插件里
 *    渲染的尺寸是 12/14/16，与官方用 `Regular` 的那批同档。
 *
 * **两档选哪一档**：全表取 `Regular`（`DEFAULT_ICON_WEIGHT`），依据是第 3 条——官方插件代码
 * 在我们这些图标、这些尺寸上用的就是它，我们的侧栏是遮蔽官方侧栏的位置，跟着官方走才不会显出
 * 两套观感。代价说明白：老一代的图形按「实心描边」量出来的相对线宽中位数是 0.082（逐枚读数散在
 * 0.060~0.178，高的那几个是实心三角形、双层文件夹这类量法偏差大的形状），`Regular` 是 0.0625、
 * `Medium` 是 0.0813——**取 `Regular` 比 0.1.6 上的观感细约四分之一**，那是官方 0.1.7 自己的
 * 口径变化，不是我们选错了。要偏回旧观感就把 `DEFAULT_ICON_WEIGHT` 改成 `'Medium'`（一行），
 * 或给表里某一枚单独写 `weight`。
 *
 * ### 线宽怎么量的
 *
 * 逐枚把官方产物的图形定义摊平成折线再量，不看截图：
 *
 * - 描边型（图形件上直接给 `strokeWidth` 的，如 `IconAlarmClockOutline16` 的 1.25）：直接读那个数；
 * - 实心型（老一代绝大多数是「把描边画成实心 path」，如 `IconPlusOutline16`）：量
 *   `2×面积/周长`——常宽描边的形状有 `面积 ≈ 线宽×中轴线长`、`周长 ≈ 2×中轴线长`，于是
 *   `2×面积/周长` 就是线宽。实心三角形、双层折叠的文件夹这类**不是常宽描边**的形状这条量法
 *   不准（量出来的数偏大），只作参考。
 *
 * 两代对照表（「上一代实测线宽」是把它折到**各自的 viewBox 单位**下量的，「相对线宽」= 线宽 ÷
 * 该代自己的 viewBox 边长，这样两代在同一个渲染尺寸下可比；`Medium` = 1.3 ÷ 新 viewBox、
 * `Regular` = 1 ÷ 新 viewBox）：
 *
 * | 该代基名（0.1.7） | 上一代名（0.1.6） | 上一代 viewBox | 上一代实测线宽 | 相对线宽 | 新一代默认 size | 新一代 viewBox | Medium 相对 | Regular 相对 | 实测更接近 | 官方插件代码怎么用 |
 * | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
 * | `IconAlarmClockOutline` | `IconAlarmClockOutline16` | 16 | 1.250（描边） | 0.0781 | 16 | 17 | 0.0765 | 0.0588 | Medium | 1× Regular |
 * | `IconArchiveOutline` | `IconArchiveOutline20` | 20 | 1.219 | 0.0610 | 20 | 16 | 0.0813 | 0.0625 | Regular | 4× Regular |
 * | `IconBranchOutline` | `IconBranchOutline16` | 16 | 1.362 | 0.0851 | 16 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconCheckOutline` | `IconCheckOutline16` | 16 | 1.296 | 0.0810 | 16 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconChecklistOutline` | `IconChecklistOutline14` | 14 | 1.195 | 0.0854 | 14 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconChevronDownOutline` | `IconChevronDownOutline14` | 14 | 1.091 | 0.0779 | 14 | 16 | 0.0813 | 0.0625 | Medium | 4× Regular |
 * | `IconChevronLeftOutline` | `IconChevronLeftOutline14` | 14 | 1.091 | 0.0779 | 14 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconChevronRightOutline` | `IconChevronRightOutline14` | 14 | 1.091 | 0.0779 | 14 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconClockOutline` | `IconClockOutline16` | 16 | 1.250（描边） | 0.0781 | 16 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconCloseFill` | `IconCloseFill14` | 14 | 1.312 | 0.0937 | 14 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconCopyOutline` | `IconCopyOutline16` | 16 | 1.323 | 0.0827 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconDownloadOutline` | `IconDownloadOutline16` | 16 | 1.362 | 0.0851 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconEditOutline` | `IconEditOutline16` | 16 | 1.408 | 0.0880 | 16 | 16 | 0.0813 | 0.0625 | Medium | 4× Regular |
 * | `IconEllipsisOutline` | `IconEllipsisOutline16` | 16 | 1.150 | 0.0718 | 16 | 16 | 0.0813 | 0.0625 | Regular | 2× Regular |
 * | `IconFolderClose` | `IconFolderClose16` | 16 | 0.952 | 0.0595 | 16 | 16 | 0.0813 | 0.0625 | Regular | 4× Regular |
 * | `IconFolderOpen` | `IconFolderOpen16` | 16 | 1.938 | 0.1211 | 16 | 16 | 0.0813 | 0.0625 | Medium | 2× Regular |
 * | `IconFolderOpenOutline` | `IconFolderOpenOutline16` | 16 | 1.448 | 0.0905 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconPlusOutline` | `IconPlusOutline16` | 16 | 1.235 | 0.0772 | 16 | 16 | 0.0813 | 0.0625 | Medium | 1× Medium（输入框）+ 1× Regular |
 * | `IconPluginPinwheelOutline`（#252 补） | `IconPluginPinwheelOutline16` | 16 | 1.200（描边） | 0.0750 | 16 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconProjectAddOutline` | `IconProjectAddOutline16` | 16 | 1.184 | 0.0740 | 16 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconRefreshOutline` | `IconRefreshOutline16` | 16 | 1.390 | 0.0868 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconRightUpOutline` | `IconRightUpOutline16` | 16 | 1.481 | 0.0926 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconSearchOutline` | `IconSearchOutline16` | 16 | 1.311 | 0.0820 | 16 | 16 | 0.0813 | 0.0625 | Medium | 2× Regular |
 * | `IconSettingsOutline` | `IconSettingsOutline16` | 16 | 1.343 | 0.0839 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 * | `IconTrashOutline` | `IconTrashOutline16` | 16 | 1.295 | 0.0809 | 16 | 16 | 0.0813 | 0.0625 | Medium | 3× Regular |
 * | `IconTriangleRightFill` | `IconTriangleRightFill14` | 14 | 2.494（实心三角，量法偏差大） | 0.1782 | 14 | 16 | 0.0813 | 0.0625 | Medium | 1× Regular |
 * | `IconUserOutline` | `IconUserOutline16` | 16 | 1.245 | 0.0778 | 16 | 16 | 0.0813 | 0.0625 | Medium | 未用 |
 *
 * ## 插件侧怎么用
 *
 * 表里的键就是**新一代的基名**（官方自己的叫法，不另起译名），值给出上一代的名字与该用的档位。
 * 取用口只有 `resolveOfficialIcon`：把官方模块的**命名空间对象**与基名交给它，它按
 * 「基名+档位 → 上一代尺寸名」的顺序挑在场的那个；**两个都不在场就抛错**，错误里写明这枚图标
 * 的两代名字、出处文件与我方使用点。
 *
 * ```ts
 * import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
 * import { resolveOfficialIcon } from '../../../src/pure/officialIcons.ts'
 *
 * export const IconTrashOutline = resolveOfficialIcon(Primitives, 'IconTrashOutline')
 * ```
 *
 * **必须用命名空间导入**（`import * as`），不能写 `import { IconTrashOutline16 }`：后者被
 * 打包器编成对同一个属性的读取，名字不在场时静默得到 `undefined`，正是这次事故的形态。
 *
 * ## 探针联动
 *
 * 这份表同时是上游探针的输入：`scripts/dsh-upstream-watch/officialIdentifiers.mjs` 拿它逐枚
 * 去本机官方产物的导出表里查在场（名字消失时当场报出是哪一枚、上一代叫什么），与
 * `src/pure/sessionPendingSource.ts` 那类「单一事实源 + 探针 import 同一份」同款做法。
 * 它没进 `clientContract.mjs` 的原因写在那个文件的「图标名为什么不在这里查」一节。
 */

/** 官方给同一枚图标的两档写法（名字后缀；画法相同、只差描边粗细）。 */
export type IconWeight = 'Medium' | 'Regular'

/**
 * 一枚图标的两代名字。
 *
 * 键（在 {@link OFFICIAL_ICON_FORKS} 里）= **新一代的基名**，完整导出名 = 基名 + 档位后缀。
 */
export interface OfficialIconFork {
  /** 上一代（0.1.6-alpha.2 及以前）的导出名：带尺寸后缀的那一个。 */
  readonly sized: string
  /**
   * 这一枚取哪一档；缺省用 {@link DEFAULT_ICON_WEIGHT}。
   * 现在全表都用缺省，留着它是为了「哪一枚要更粗」这件事能改在表里、不散到调用点。
   */
  readonly weight?: IconWeight
}

/** 缺省档位（依据见文件头「两档选哪一档」）。 */
export const DEFAULT_ICON_WEIGHT: IconWeight = 'Regular'

/**
 * 我们取用的 27 枚官方图标：键 = 新一代基名，值 = 上一代的尺寸后缀名。
 *
 * 全部 27 组的「新一代默认 size = 上一代尺寸后缀」在 0.1.7-alpha.2 上逐枚核过（文件头的表）；
 * 其中第 27 枚（`IconPluginPinwheelOutline`，#252 侧栏工具栏那枚「插件」）两代连图画数据都
 * 逐字相同，见文件头第 2 条那一小段。
 */
export const OFFICIAL_ICON_FORKS = {
  IconAlarmClockOutline: { sized: 'IconAlarmClockOutline16' },
  IconArchiveOutline: { sized: 'IconArchiveOutline20' },
  IconBranchOutline: { sized: 'IconBranchOutline16' },
  IconCheckOutline: { sized: 'IconCheckOutline16' },
  IconChecklistOutline: { sized: 'IconChecklistOutline14' },
  IconChevronDownOutline: { sized: 'IconChevronDownOutline14' },
  IconChevronLeftOutline: { sized: 'IconChevronLeftOutline14' },
  IconChevronRightOutline: { sized: 'IconChevronRightOutline14' },
  IconClockOutline: { sized: 'IconClockOutline16' },
  IconCloseFill: { sized: 'IconCloseFill14' },
  IconCopyOutline: { sized: 'IconCopyOutline16' },
  IconDownloadOutline: { sized: 'IconDownloadOutline16' },
  IconEditOutline: { sized: 'IconEditOutline16' },
  IconEllipsisOutline: { sized: 'IconEllipsisOutline16' },
  IconFolderClose: { sized: 'IconFolderClose16' },
  IconFolderOpen: { sized: 'IconFolderOpen16' },
  IconFolderOpenOutline: { sized: 'IconFolderOpenOutline16' },
  IconPluginPinwheelOutline: { sized: 'IconPluginPinwheelOutline16' },
  IconPlusOutline: { sized: 'IconPlusOutline16' },
  IconProjectAddOutline: { sized: 'IconProjectAddOutline16' },
  IconRefreshOutline: { sized: 'IconRefreshOutline16' },
  IconRightUpOutline: { sized: 'IconRightUpOutline16' },
  IconSearchOutline: { sized: 'IconSearchOutline16' },
  IconSettingsOutline: { sized: 'IconSettingsOutline16' },
  IconTrashOutline: { sized: 'IconTrashOutline16' },
  IconTriangleRightFill: { sized: 'IconTriangleRightFill14' },
  IconUserOutline: { sized: 'IconUserOutline16' },
} as const

/** 表里的基名（探针与单测按它遍历）。 */
export type OfficialIconName = keyof typeof OFFICIAL_ICON_FORKS

/** 表里全部基名（顺序与表一致）。 */
export const OFFICIAL_ICON_NAMES = Object.keys(OFFICIAL_ICON_FORKS) as readonly OfficialIconName[]

/**
 * 官方图标模块的命名空间（`import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'`）。
 *
 * 写成宽泛的记录类型而不是官方模块的形状：官方每加一枚图标都会改那个形状，这里只按下标取，
 * 不该跟着变。
 */
export type OfficialIconNamespace = Readonly<Record<string, unknown>>

/** 取到的官方图标件（我们只传 `size` / `className`，与官方导出的那几个 prop 一致）。 */
export type OfficialIconComponent = (props: { readonly size?: number; readonly className?: string }) => unknown

/**
 * 一枚图标在各代里的候选导出名，**按解析顺序**（当代要的那一档 → 上一代的名字）。
 *
 * 探针与单测拿它核对「官方导出表里至少有一个在场」，与运行时挑的是同一份顺序，两处不会漂。
 */
export function iconExportCandidates(name: OfficialIconName): readonly string[] {
  const fork: OfficialIconFork = OFFICIAL_ICON_FORKS[name]
  return [`${name}${fork.weight ?? DEFAULT_ICON_WEIGHT}`, fork.sized]
}

/**
 * 从官方模块的命名空间里取一枚图标件；两面都不在场时**当场抛错**。
 *
 * 抛错而不是返回 `undefined`：`undefined` 流到渲染会炸成 React #130（元素类型是 `undefined`），
 * 报错信息里只有一句「Minified React error」，看不出是哪枚图标、哪一代名字没了（#236 的现场就是
 * 这样查了半天）。这里抛的错把「哪一枚、这一代叫什么、上一代叫什么、出处是哪、我方用在哪」一次
 * 说全；另一档在场时还会顺带说一句「改成哪一档就行」。
 */
export function resolveOfficialIcon(namespace: OfficialIconNamespace, name: OfficialIconName): OfficialIconComponent {
  const fork: OfficialIconFork = OFFICIAL_ICON_FORKS[name]
  const weight = fork.weight ?? DEFAULT_ICON_WEIGHT
  for (const candidate of iconExportCandidates(name)) {
    const found = namespace[candidate]
    if (typeof found === 'function') return found as OfficialIconComponent
  }
  const other: IconWeight = weight === 'Medium' ? 'Regular' : 'Medium'
  const otherHint =
    typeof namespace[`${name}${other}`] === 'function'
      ? ` Only \`${name}${other}\` is exported; set this icon's weight to '${other}' in officialIcons.ts.`
      : ''
  // 报错文案用英文：src 里的运行期错误一律英文（i18n 门禁只放行注释与已登记的词条），
  // 与既有的 `UI manifest: no bootstrap batch` 同一约定；给人看的说明在上面这段注释里。
  throw new Error(
    `dsh official icon export missing: ${name} expects \`${name}${weight}\` on this generation ` +
      `and \`${fork.sized}\` on the previous one, neither is exported by ` +
      `@deepseek-ai/dsh-client-ui-primitives.${otherHint}`,
  )
}
