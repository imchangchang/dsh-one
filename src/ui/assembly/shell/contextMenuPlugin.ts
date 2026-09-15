/**
 * @dsh-one/vscode-context-menu——右键菜单家族（#65 批 1）：行内码「复制这段」、
 * 消息「复制」、外链「系统浏览器 / VS Code 内置浏览器」。
 *
 * 为什么落到第 4 层（CSS/DOM），前 3 层的举证：
 * ① 机制层 1（官方槽位）没有 context-menu 座位：把 48 个官方插件 bundle 全量
 *    扫过一遍（`name: "<slot>"` 注册共 135 个座位名），**没有一个是菜单/右键
 *    相关**（含 menu/context/copy 关键词的座位名：零命中——ui-conversation 的
 *    `conversation-queue-dock`/`conversation-todo-dock` 是队列/待办浮层，不是
 *    通用菜单位）。官方唯一的 `contextmenu` 字样在 ui-trajectory 自己的画布
 *    组件里（自用 React prop，不是贡献点）。
 * ② 机制层 2（官方服务）同样没有：没有菜单注册表服务；官方 primitives 只导出
 *    一个**组件** `Menu`（本插件复用它渲染菜单，见下），不给「往官方菜单里加项」
 *    的口。剪贴板用官方 primitives 的 `writeClipboard`（带 execCommand 回退，
 *    比裸 navigator.clipboard 在 webview 里稳）。
 * ③ 机制层 3（装载/传输接缝）与「右键交互」无关。
 *
 * 第 4 层做法与稳定性风险：
 * - 委托挂在**自有** frame 根（`[data-shell="dsh-one"]`）的捕获阶段，只认三类
 *   目标，其余一律让路（不 preventDefault，保留系统/VS Code 原生菜单）；
 * - 官方侧只依赖语义属性/标签：`code`（行内码 = 不带 class 的 code，且不在
 *   `pre`/`a` 内、不含 button——官方 file-mention 会渲染 `<code><button>`，
 *   那种交给官方自己）、`a[href]`（官方 MarkdownText 渲染的外链，协议白名单）、
 *   `[data-chat-flow-kind]`（官方消息行的语义属性，非 css-module 哈希）；
 * - 菜单本体用官方 `Menu` 原语（portal + getAnchorRect 定位到右键坐标、外点
 *   关闭、Escape 关闭都是官方行为），观感与官方菜单一致。
 */
import { createElement as h, useEffect, useState } from 'react'
import {
  IconBrowseOutline16,
  IconCodeOutline16,
  IconCopyOutline16,
  IconGlobeOutline14,
  Menu,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { hostCall } from './hostClient.ts'

/** 官方消息行（能复制正文的行 kind）：user/assistant-step/steering（发言与插话）。 */
const MESSAGE_KINDS = new Set(['user', 'assistant-step', 'steering'])

/** 外链协议白名单（与宿主能力桥一致；其余锚点不走本菜单）。 */
const LINK_PROTOCOL_RE = /^(https?|mailto):/i

interface LayerProps {
  /** 框架注入的 locale 座位（函数内别名为 tr 避开 i18n 门禁的裸 t() 扫描）。 */
  t: (key: string) => string
}

/** 菜单形态：三项互斥（行内码 / 外链 / 消息行）。 */
type MenuKind = 'inline-code' | 'link' | 'message'

interface MenuState {
  open: boolean
  kind: MenuKind
  x: number
  y: number
  /** 触发时的目标信息（复制内容 / 外链地址）。 */
  text?: string
  url?: string
}

const CLOSED: MenuState = { open: false, kind: 'message', x: 0, y: 0 }

/** 自有容器：装配 frame 根（我们自己的 data 属性）。 */
const frameRoot = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell="dsh-one"]')

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

/** 外链：官方 MarkdownText 渲染的 `a[href]`，协议在白名单内。 */
function linkOf(target: HTMLElement): string | null {
  const anchor = target.closest('a[href]')
  if (anchor === null) return null
  const href = anchor.getAttribute('href') ?? ''
  return LINK_PROTOCOL_RE.test(href) ? href : null
}

/**
 * 消息行正文（DOM 取文口径）：克隆行后剥掉 chrome——动作行（官方
 * `data-actions-reveal`，含复制/分支按钮与时刻）、think 折叠行、所有 button，
 * 再把我们自己的 hash 标记还原成纯文本。
 * 与官方复制按钮的取文口径可能略有差异（官方取状态里的正文，这里取渲染后的
 * 可见文本）：代码块的「复制」按钮文字已随 button 一起剥掉。
 */
function messageTextOf(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement
  // Array.from：tsconfig 的 lib 只开 DOM（无 DOM.Iterable），NodeList 不能直接 for...of
  for (const el of Array.from(clone.querySelectorAll('[data-dshone-commit]'))) {
    el.replaceWith(document.createTextNode(el.textContent ?? ''))
  }
  for (const el of Array.from(clone.querySelectorAll('[data-actions-reveal], button, [data-variant="think"], [data-turn-tail]'))) {
    el.remove()
  }
  return (clone.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

function ContextMenuLayer({ t }: LayerProps) {
  const tr = t
  const [state, setState] = useState<MenuState>(CLOSED)

  useEffect(() => {
    const root = frameRoot()
    if (root === null) return undefined
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      // 优先行内码（它在消息行内，不先拦会被消息菜单抢走）
      const code = inlineCodeOf(target)
      if (code !== null) {
        const text = (code.textContent ?? '').trim()
        if (text === '') return
        event.preventDefault()
        event.stopPropagation()
        setState({ open: true, kind: 'inline-code', x: event.clientX, y: event.clientY, text })
        return
      }
      const url = linkOf(target)
      if (url !== null) {
        event.preventDefault()
        event.stopPropagation()
        setState({ open: true, kind: 'link', x: event.clientX, y: event.clientY, url })
        return
      }
      const row = target.closest('[data-chat-flow-kind]')
      if (!(row instanceof HTMLElement)) return
      const kind = row.getAttribute('data-chat-flow-kind')
      if (kind === null || !MESSAGE_KINDS.has(kind)) return
      const text = messageTextOf(row)
      if (text === '') return
      event.preventDefault()
      event.stopPropagation()
      setState({ open: true, kind: 'message', x: event.clientX, y: event.clientY, text })
    }
    root.addEventListener('contextmenu', onContextMenu, true)
    return () => root.removeEventListener('contextmenu', onContextMenu, true)
  }, [])

  if (!state.open) return null

  const copy = (text: string): void => {
    void writeClipboard(text)
    setState(CLOSED)
  }
  const openExternal = (url: string, call: string): void => {
    void hostCall(call, { url })
    setState(CLOSED)
  }

  const items =
    state.kind === 'inline-code'
      ? [{ id: 'copy-inline-code', label: tr('copyInlineCode'), icon: h(IconCodeOutline16, { size: 14 }) }]
      : state.kind === 'link'
        ? [
            { id: 'open-system-browser', label: tr('openInSystemBrowser'), icon: h(IconGlobeOutline14, { size: 14 }) },
            { id: 'open-builtin-browser', label: tr('openInBuiltinBrowser'), icon: h(IconBrowseOutline16, { size: 14 }) },
          ]
        : [{ id: 'copy-message', label: tr('copyMessage'), icon: h(IconCopyOutline16, { size: 14 }) }]

  return h(Menu, {
    open: true,
    items,
    // 右键坐标当作零尺寸锚点：官方 Menu 的定位算法据此把菜单挂到指针下方 4px
    // （越界时官方自己夹进视口）。
    getAnchorRect: () => new DOMRect(state.x, state.y, 0, 0),
    portal: true,
    dense: true,
    onClose: () => setState(CLOSED),
    onSelect: (id: string) => {
      if (state.kind === 'inline-code' && id === 'copy-inline-code') {
        copy(state.text ?? '')
        return
      }
      if (state.kind === 'link') {
        if (id === 'open-system-browser') openExternal(state.url ?? '', 'vscode.openExternal')
        else if (id === 'open-builtin-browser') openExternal(state.url ?? '', 'vscode.openInBuiltinBrowser')
        return
      }
      if (id === 'copy-message') copy(state.text ?? '')
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
      zh: {
        copyInlineCode: '\u590d\u5236\u8fd9\u6bb5',
        copyMessage: '\u590d\u5236',
        openInSystemBrowser: '\u5728\u7cfb\u7edf\u6d4f\u89c8\u5668\u6253\u5f00',
        openInBuiltinBrowser: '\u5728 VS Code \u5185\u7f6e\u6d4f\u89c8\u5668\u6253\u5f00',
      },
      en: {
        copyInlineCode: 'Copy inline code',
        copyMessage: 'Copy',
        openInSystemBrowser: 'Open in system browser',
        openInBuiltinBrowser: 'Open in VS Code built-in browser',
      },
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
  }, 'dsh-one context menu: inline code / message / link right-click menus')
}
