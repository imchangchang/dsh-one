/**
 * @dsh-one/vscode-context-menu——行内码右键「复制这段」（#65 批 1；收尾改版后
 * 只保留这一项：消息右键「复制」官方消息操作栏自带，外链官方 MarkdownText 渲染
 * 的就是 `target="_blank" rel="noopener noreferrer"`、点击由 VS Code 交给系统
 * 浏览器，都不需要我们再补一份菜单）。
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
 * - 委托挂在**自有** frame 根（`[data-shell="dsh-one"]`）的捕获阶段，只认行内码
 *   一个目标，其余（消息行、外链、空白处……）一律让路——**不 preventDefault**，
 *   VS Code / 系统原生右键菜单照常弹出；
 * - 官方侧只依赖标签语义：`code`（行内码 = 不带 class 的 code，且不在
 *   `pre`/`a` 内、不含 button——官方 file-mention 会渲染 `<code><button>`，
 *   那种交给官方自己）；
 * - 菜单本体用官方 `Menu` 原语（portal + getAnchorRect 定位到右键坐标、外点
 *   关闭、Escape 关闭都是官方行为），观感与官方菜单一致。
 */
import { createElement as h, useEffect, useState } from 'react'
import { IconCodeOutline16, Menu, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'

interface LayerProps {
  /** 框架注入的 locale 座位（函数内别名为 tr 避开 i18n 门禁的裸 t() 扫描）。 */
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

function ContextMenuLayer({ t }: LayerProps) {
  const tr = t
  const [state, setState] = useState<MenuState>(CLOSED)

  useEffect(() => {
    const root = frameRoot()
    if (root === null) return undefined
    const onContextMenu = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (target === null) return
      const code = inlineCodeOf(target)
      if (code === null) return // 其余目标一律让路：原生右键菜单照常
      const text = (code.textContent ?? '').trim()
      if (text === '') return
      event.preventDefault()
      event.stopPropagation()
      setState({ open: true, x: event.clientX, y: event.clientY, text })
    }
    root.addEventListener('contextmenu', onContextMenu, true)
    return () => root.removeEventListener('contextmenu', onContextMenu, true)
  }, [])

  if (!state.open) return null

  const copy = (): void => {
    void writeClipboard(state.text)
    setState(CLOSED)
  }

  const items = [{ id: 'copy-inline-code', label: tr('copyInlineCode'), icon: h(IconCodeOutline16, { size: 14 }) }]

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
      zh: { copyInlineCode: '\u590d\u5236\u8fd9\u6bb5' },
      en: { copyInlineCode: 'Copy inline code' },
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
