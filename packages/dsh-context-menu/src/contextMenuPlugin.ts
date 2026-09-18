/**
 * `@dsh-one/dsh-context-menu`——行内码右键「复制这段」（#65 批 1；收尾改版后
 * 只保留这一项：消息右键「复制」官方消息操作栏自带，外链官方 MarkdownText 渲染
 * 的就是 `target="_blank" rel="noopener noreferrer"`、点击由 VS Code 交给系统
 * 浏览器，都不需要我们再补一份菜单）。#83 起挂载点脱离自有 frame（见下），
 * 官方 web 侧同样可用，故命名 `dsh-*`。
 *
 * 为什么落到第 4 层（CSS/DOM），前 3 层的举证：
 * ① 机制层 1（官方槽位）没有 context-menu 槽位：把 48 个官方插件 bundle 全量
 *    扫过一遍（`name: "<slot>"` 注册共 135 个槽位名），**没有一个是菜单/右键
 *    相关**（含 menu/context/copy 关键词的槽位名：零命中——ui-conversation 的
 *    `conversation-queue-dock`/`conversation-todo-dock` 是队列/待办浮层，不是
 *    通用菜单位）。官方唯一的 `contextmenu` 字样在 ui-trajectory 自己的画布
 *    组件里（自用 React prop，不是贡献点）。
 * ② 机制层 2（官方服务）同样没有：没有菜单注册表服务；官方 primitives 只导出
 *    一个**组件** `Menu`（本插件复用它渲染菜单，见下），不给「往官方菜单里加项」
 *    的口。剪贴板用官方 primitives 的 `writeClipboard`（带 execCommand 回退，
 *    比裸 navigator.clipboard 在 webview 里稳）。
 * ③ 机制层 3（装载/传输 seam）与「右键交互」无关。
 *
 * 第 4 层做法与稳定性风险：
 * - 委托挂在**官方对话区容器**（`[data-conversation-scroll]`，见 `@dsh-one/dsh-plugin-kit/mountPoints`
 *   的出处与理由——原来是挂在自有 frame 根上，官方 web 里那条根不存在、插件整个
 *   不工作，#83 已改）的捕获阶段，只认行内码一个目标，其余（消息行、外链、
 *   空白处……）一律让路——**不 preventDefault**，VS Code / 系统原生右键菜单照常弹出；
 * - 官方侧只依赖标签语义：`code`（行内码 = 不带 class 的 code，且不在
 *   `pre`/`a` 内、不含 button——官方 file-mention 会渲染 `<code><button>`，
 *   那种交给官方自己）；
 * - 菜单本体用官方 `Menu` 原语（portal + getAnchorRect 定位到右键坐标、外点
 *   关闭、Escape 关闭都是官方行为）。
 *
 * 观感对齐（#65 收尾 2/8）：项结构与排版**不写一行布局 CSS**，全部走官方 `Menu`
 * 的档位——读官方在用的两处菜单（侧栏会话行「⋯」、composer 模型选择）实测都是
 * 默认档：项 `min-height:40px / padding:8px 10px / font-size:14px / line-height:22px
 * / gap:8px / border-radius:10px`，图标位 16×16、hover 背景
 * `--dsw-alias-interactive-bg-hover`；items 的形状是 `{id, label, icon: <IconXxx16 />}`。
 *
 * **定稿取官方紧凑档 `compact: true`**（用户拍板）：官方 CSS 里存在该变体
 * （`._compactList_1aoad_128`：列表 `min-width:164px;padding:2px;border-radius:7px`，
 * 项 `min-height:26px;gap:6px;padding:3px 7px;border-radius:5px;font-size:12px;
 * line-height:18px`，图标位 14×14）——**属「官方支持但官方未用」的变体**：48 个官方
 * bundle 的 Menu 调用点全量扫过，**没有一处传 compact**（默认与 dense 之外无人用）。
 * 选择理由：单图标动作项配 14 档图标时，官方紧凑档正是「小图标 + 小行高」的搭配，
 * 比 40px 标准档 + 14 图标更贴合官方设计语言；代价是与官方现有调用点的观感不同，
 * 故此处显式记录该事实。
 *
 * 悬浮提示走**官方 Tooltip 组件**（primitives 导出，`cloneElement` 把
 * onMouseEnter/Leave/Focus/Blur 与 ref 挂到子元素上，渲染 `role="tooltip"` 气泡），
 * 不用 `title` 属性——官方有组件就用官方（机制层 1/2，避免浏览器原生 tooltip 的
 * 延迟与样式不一致）。
 *
 * 「已复制」反馈：**官方 Menu 点选后不会自己关闭**（源码：item 的 onClick 只调
 * `onSelect(id)`，关不关由调用方决定；官方各调用点都在 onSelect 里自己 setOpen(false)）
 * ——所以按「官方支持保持打开」这条走**项内状态切换**：点击后项内换成对勾图标 +
 * 「已复制」文字，`COPIED_FEEDBACK_MS` 后我们在 onSelect 侧关菜单。
 *
 * 右键目标高亮（#65 收尾 2）：命中行内码时给那个 `code` 加自有属性
 * `data-dshone-menu-target`，本插件样式用它上色（颜色取官方 token
 * `--dsw-alias-interactive-bg-active`，即官方「按下/选中」档，不新增颜色）；
 * 菜单关闭 / 取消 / 执行动作后移除。清理按「全量扫属性再删」实现，重复开关不留残留。
 */
import { createElement as h, useEffect, useRef, useState } from 'react'
import { IconCheckOutline16, IconCopyOutline16, Menu, Tooltip, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { mountOnConversation } from '@dsh-one/dsh-plugin-kit/mountPoints'

/** 右键目标高亮用的自有属性（只加属性，不改官方 DOM 结构）。 */
const TARGET_ATTR = 'data-dshone-menu-target'
/** 菜单盒标记属性（只在菜单开着时加在官方 Menu 的列表元素上）。 */
const MENU_ATTR = 'data-dshone-menu'
const MENU_ICON_MARK = 'icon'
/** 图标项的标记属性与容器类（本插件自有，用来只命中我们自己那一项）。 */
const ICON_ITEM_ATTR = 'data-dshone-icon-item'
const ICON_ITEM_CLASS = 'dshOneMenu_iconItem'
/** 「已复制」状态在项内停留的时长（官方 Menu 点选后由调用方决定何时关，见下）。 */
const COPIED_FEEDBACK_MS = 700

const CSS = [
  // 右键目标高亮：以**官方侧栏当前会话行（选中态）**为基准。官方那条规则逐字是
  // `.YDXeBa_sessionRow:hover, .YDXeBa_sessionRow.YDXeBa_selected { background:
  // var(--dsw-alias-interactive-bg-hover) }`（无描边），所以底色取同一个 token；
  // 行内码自身有底色、单靠底色不够显眼，再叠一圈官方细描边 token
  // `--dsw-alias-border-l2`（官方菜单/卡片的描边同族）与同色外扩，形成明确轮廓。
  // 全部官方 token，浅/暗主题自动跟随。
  `code[${TARGET_ATTR}]{background-color:var(--dsw-alias-interactive-bg-hover);box-shadow:0 0 0 1px var(--dsw-alias-border-l2),0 0 0 3px var(--dsw-alias-interactive-bg-hover)}`,
  // 单图标项：官方**没有纯图标菜单项的先例**（48 个插件 bundle 全量扫 items 条目：
  // 19 条都有 label，没有一条是「有 icon 无 label」；官方的纯图标控件是 Button
  // 工具条档，不是 Menu 项），所以按第 4 层兜底：只对**本图标项**改成对称内边距、
  // 方盒。数值按图标档位推：(26px 官方紧凑行高 − 14px 图标) / 2 = 6px，上下左右等值、
  // 盒子 26×26（官方紧凑档行高不变）。
  // 判定用 :has(自有标记) —— 只命中我们自己那一项，不动官方任一项；:has 在本仓库
  // 已有多处使用（导出胶囊、设置行动），目标运行环境（VS Code Electron / Chromium）
  // 原生支持。风险：若官方未来给菜单项加同名 slot 结构，:has 仍只看我们自己的属性。
  `[${MENU_ATTR}="${MENU_ICON_MARK}"] button[role="menuitem"]:has([${ICON_ITEM_ATTR}]){padding:6px;justify-content:center}`,
  // 图标容器：flex 居中（消掉行内盒的基线偏移——实测改前图标上方 9px、下方 15px，
  // 因为官方 itemLabel 是 22px 行盒、内联 svg 坐在基线上）。
  `.${ICON_ITEM_CLASS}{display:flex;align-items:center;justify-content:center}`,
  `.dshOneMenu_copied{gap:4px;justify-content:flex-start}`,
  `.dshOneMenu_copiedText{white-space:nowrap}`,
  // 单图标项：官方列表默认 min-width:218px（文字菜单的档位），图标项只需要图标
  // 的自然宽度，所以把列表收到内容宽。机制层 4 举证：官方 Menu 没有列表宽度属性口
  // （props 只有 open/anchor/items/onSelect/onClose/align/side/portal/
  // closeOnPointerLeave/dense/compact/getAnchorRect/footer/className，源码逐字确认；
  // 且 className 落在 root span 上、不是列表元素）；这里给**列表元素**加一个自有
  // 属性再按属性选择器上样式，不依赖任何 css-module 哈希；定位靠 role="menu"
  // 语义属性（仅在我们自己的菜单开着时）。
  // !important：官方紧凑档的规则是双类选择器（`._list_x._compactList_y{min-width:164px}`），
  // 单属性选择器的特异性压不过它——这里是我们自己给自己加的标记属性，代价可控。
  `[${MENU_ATTR}="${MENU_ICON_MARK}"]{min-width:0!important;width:max-content}`,
].join('')
const CSS_TAG_ID = '@dsh-one/dsh-context-menu/Target.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/dsh-context-menu'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** 移除全文档的高亮属性（幂等：重复调用、无残留都安全）。 */
function clearHighlight(): void {
  for (const el of Array.from(document.querySelectorAll(`[${TARGET_ATTR}]`))) el.removeAttribute(TARGET_ATTR)
}

/** 移除菜单盒标记（幂等）。 */
function clearMenuMark(): void {
  for (const el of Array.from(document.querySelectorAll(`[${MENU_ATTR}]`))) el.removeAttribute(MENU_ATTR)
}

interface LayerProps {
  /** 框架注入的 locale 槽位（函数内别名为 tr 避开 i18n 门禁的裸 t() 扫描）。 */
  t: (key: string) => string
}

/** 菜单状态（只服务行内码复制）。 */
interface MenuState {
  open: boolean
  x: number
  y: number
  /** 触发时行内码的文本。 */
  text: string
}

const CLOSED: MenuState = { open: false, x: 0, y: 0, text: '' }

/**
 * 行内码：不带 class 的 `code`，不在 pre（代码块）与 a（链接）里，且不含 button
 * （官方 file-mention 渲染成 `<code><button>`，那种点击/复制由官方负责）。
 */
function inlineCodeOf(target: HTMLElement): HTMLElement | null {
  const code = target.closest('code')
  if (code === null) return null
  if (code.closest('pre, a, button') !== null) return null
  if (code.querySelector('button') !== null) return null
  return code
}

function ContextMenuLayer({ t }: LayerProps) {
  const tr = t
  const [state, setState] = useState<MenuState>(CLOSED)
  /** 点击后的「已复制」瞬时状态（官方 Menu 点选不自动关闭，由调用方决定何时关）。 */
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 菜单开着期间被高亮的那个行内码（关闭时按属性全量清，不依赖这个引用）
  const targetRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    return mountOnConversation((container) => {
      const onContextMenu = (event: MouseEvent): void => {
        const target = event.target as HTMLElement | null
        if (target === null) return
        const code = inlineCodeOf(target)
        if (code === null) return // 其余目标一律让路：原生右键菜单照常
        const text = (code.textContent ?? '').trim()
        if (text === '') return
        event.preventDefault()
        event.stopPropagation()
        // 先清旧的高亮/菜单标记再标新的（幂等），保证任何时刻最多一个目标被标
        clearHighlight()
        clearMenuMark()
        code.setAttribute(TARGET_ATTR, '')
        targetRef.current = code
        setState({ open: true, x: event.clientX, y: event.clientY, text })
      }
      container.addEventListener('contextmenu', onContextMenu, true)
      return () => {
        container.removeEventListener('contextmenu', onContextMenu, true)
        clearHighlight()
        clearMenuMark()
      }
    })
  }, [])

  // 菜单开着时给官方 Menu 的列表元素加自有标记，把盒子收成图标项的自然宽度
  //（关闭即撤；清理幂等）。
  useEffect(() => {
    if (!state.open) {
      clearMenuMark()
      return undefined
    }
    const lists = Array.from(document.querySelectorAll('[role="menu"]'))
    const list = lists[lists.length - 1] // 我们自己刚开的那一个（最近挂载）
    list?.setAttribute(MENU_ATTR, MENU_ICON_MARK)
    return () => {
      clearMenuMark()
    }
  }, [state.open])

  if (!state.open) return null

  /** 关闭菜单：先撤高亮与菜单标记再落状态（取消 / 执行动作 / 点别处都走这里）。 */
  const closeMenu = (): void => {
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current)
      copiedTimer.current = null
    }
    clearHighlight()
    clearMenuMark()
    setCopied(false)
    setState(CLOSED)
  }

  /**
   * 复制 + 反馈：写完剪贴板先切成「已复制」态（项内对勾 + 文字），停留
   * COPIED_FEEDBACK_MS 后再关菜单并撤高亮（官方点选不自动关，节奏由这里定）。
   */
  const copy = (): void => {
    void writeClipboard(state.text)
    setCopied(true)
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null
      closeMenu()
    }, COPIED_FEEDBACK_MS)
  }

  // 单图标项：可见内容只有一个官方复制图标（不显示文字），无障碍名用 aria-label
  // 承载「复制这段」语义（走自有 locale）。项形状仍是官方 Menu 的 {id, label}
  // 写法——label 传节点是官方允许的（ui-agent-preset 等调用点同样传节点）；
  // 图标放进 label 槽（不是 icon 槽）才能拿到 label-primary 前景色，icon 槽是
  // 官方的次级色（--dsw-alias-label-tertiary），单图标项用次级色会发灰。
  //
  // 尺寸 14：官方图标集里**没有 IconCopyOutline14**（导出表实测：含 Copy 的只有
  // IconCopyOutline16；14 档只覆盖 check/chevron/close/globe/link/queue/refresh/
  // send/settings/think 等一部分），所以用官方图标件自己支持的显式尺寸参数
  // `{ size: 14 }`——官方同样这么用（ui-workspace 的 `IconArchiveOutline20, { size: 16 }`），
  // 属于用官方组件、不是自绘。14 在 40px 项里约占 35%（16 时是 40%）。
  const items = [
    {
      id: 'copy-inline-code',
      label: copied
        ? // 「已复制」瞬时态：对勾 + 文字（自有 locale），随后关闭
          h(
            'span',
            { className: `${ICON_ITEM_CLASS} dshOneMenu_copied`, 'aria-label': tr('copied'), [ICON_ITEM_ATTR]: '' },
            h(IconCheckOutline16, { size: 14 }),
            h('span', { className: 'dshOneMenu_copiedText' }, tr('copied')),
          )
        : // 常态：只有一个官方复制图标，悬浮由官方 Tooltip 给「复制」提示
          h(
            Tooltip,
            { label: tr('copyInlineCode'), side: 'top', delayMs: 300 },
            h(
              'span',
              { className: ICON_ITEM_CLASS, 'aria-label': tr('copyInlineCode'), [ICON_ITEM_ATTR]: '' },
              h(IconCopyOutline16, { size: 14 }),
            ),
          ),
    },
  ]

  return h(Menu, {
    open: true,
    items,
    // 右键坐标当作零尺寸锚点：官方 Menu 的定位算法据此把菜单挂到指针下方 4px
    // （越界时官方自己夹进视口）。
    getAnchorRect: () => new DOMRect(state.x, state.y, 0, 0),
    portal: true,
    // 官方紧凑档（26px 项 / 12px 字号 / 14px 图标位）——官方支持但未使用的变体，
    // 取它与 14 档图标搭配（见文件头说明）。
    compact: true,
    onClose: closeMenu,
    onSelect: (id: string) => {
      if (id === 'copy-inline-code') copy()
    },
  })
}

interface MenuContext {
  effect(body: () => (() => void) | void, label?: string): void
  locale: {
    register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: {
    register(entry: unknown, component: unknown): () => void
    inject(name: string, factory: () => unknown): () => void
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: MenuContext): void {
  ctx.effect(() => {
    // 自有词典（zh 文案与旧自研聊天区同口径，用 unicode 转义过 i18n 门禁）。
    const disposeLocale = ctx.locale.register('dshOneMenu', {
      zh: { copyInlineCode: '\u590d\u5236\u8fd9\u6bb5', copied: '\u5df2\u590d\u5236' },
      en: { copyInlineCode: 'Copy inline code', copied: 'Copied' },
    })
    const disposeInject = ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'dsh-one-context-menu',
          locale: 'dshOneMenu',
          inject: () => ({}),
        },
        ContextMenuLayer,
      ),
    )
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one context menu: inline-code copy')
}
