/**
 * 顶栏「折叠 / 展开全部」按钮的两枚图标（#118）：**方框里一条横杠**（点了就折叠
 * 全部）与**方框里一个十字**（点了就展开全部）。用户实测要求把原来的 chevron 换成
 * 这两枚，理由是方框加减号是 VS Code 树控件既有的交互语言。
 *
 * ## 官方 primitives 里没有这两枚（举证，2026-09-16，网关上的 dsh 0.1.6-alpha.1）
 *
 * 官方前端把 primitives 模块直接打进页面自己的 chunk 里（`/assets/index-*.js`），
 * 那一段的模块命名空间对象（带 `Symbol.toStringTag: "Module"` 的那个）共 130 个
 * 导出，其中 `Icon*` **79 个**，逐个核对：**没有方框加减号，也没有单独的
 * minus/subtract**（`IconPlusOutline16` 是唯一一枚「加」，还是光秃秃一个 ＋，
 * 放进方框语义会与同一行的「添加工作区」撞脸）。官方全部前端插件拼成的那份 combo
 * 里另外出现的图标名只有 `IconWrapFill16` / `IconNowrapFill16` / `IconActions`，
 * 同样没有。所以这两枚只能由我们自绘。
 *
 * ## 路径数据的出处
 *
 * 逐字取自我们旧侧栏那两枚（`src/ui/shared/icons.ts` 的 `boxedMinus` / `boxedPlus`：
 * 共用的圆角方框 `BOX_OUTLINE` 加各自中间那一笔，16 格坐标、`fillRule: 'evenodd'`）。
 * 旧侧栏的顶栏就是这枚按钮、同一套语义（`sessionsWebview.ts` 里
 * `allCollapsed ? boxedPlus : boxedMinus`，尺寸同样 16），观感与旧侧栏逐字一致。
 *
 * **刻意不 import 那个模块**：它是摘钩后的退役件，装配件的 bundle 只该带上真要的
 * 这几条路径，不该为两枚图标把整份图标表（几十枚，含 goal 那种复合大图）拉进来。
 * 路径原样复制、**不重新画**——`test/collapseAllGlyph.test.ts` 拿两份数据逐字比对，
 * 谁改了其中一份都会红。
 *
 * 本文件**不引任何模块**（连 react 都不引）：装配实验室的套件要 import 它拿期望值
 * 去比对页面渲染出的 `path@d`，而实验室跑在 node 里，react 与官方 primitives 在
 * 那边都解析不到。
 */

/**
 * 圆角方框（旧侧栏的 `BOX_OUTLINE`）：外圈 11×11、圆角 2，内圈再画一个 0.8 线宽的
 * 圆角方框；两条同向路径配 `fill-rule: evenodd` 挖空成描边效果。
 */
export const COLLAPSE_ALL_BOX =
  'M4.5 2.5H11.5A2 2 0 0 1 13.5 4.5V11.5A2 2 0 0 1 11.5 13.5H4.5A2 2 0 0 1 2.5 11.5V4.5A2 2 0 0 1 4.5 2.5Z' +
  'M4.5 3.7H11.5A0.8 0.8 0 0 1 12.3 4.5V11.5A0.8 0.8 0 0 1 11.5 12.3H4.5A0.8 0.8 0 0 1 3.7 11.5V4.5A0.8 0.8 0 0 1 4.5 3.7Z'

/** 方框里的横杠（旧侧栏的 `boxedMinus` 那一笔）。 */
export const COLLAPSE_ALL_MINUS = 'M5.3 7.35H10.7V8.65H5.3Z'

/** 方框里的十字（旧侧栏的 `boxedPlus` 那一笔）。 */
export const COLLAPSE_ALL_PLUS = 'M8.65 5.3V7.35H10.7V8.65H8.65V10.7H7.35V8.65H5.3V7.35H7.35V5.3Z'

/** 两枚图标各自的路径表，顺序 = 绘制顺序（先方框，再中间那一笔）。 */
export const COLLAPSE_ALL_GLYPHS = {
  minus: [COLLAPSE_ALL_BOX, COLLAPSE_ALL_MINUS],
  plus: [COLLAPSE_ALL_BOX, COLLAPSE_ALL_PLUS],
} as const

/** 图标有哪两态：`minus` = 折叠全部（还有东西展开着），`plus` = 展开全部（全折叠了）。 */
export type CollapseAllGlyph = keyof typeof COLLAPSE_ALL_GLYPHS
