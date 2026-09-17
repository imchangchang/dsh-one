/**
 * `@dsh-one/dsh-session-export`——chat 树的会话日志导出（#71 验收返修；#84 迁移到
 * 宿主能力口并改名 dsh-*）。
 *
 * ## 为什么是 dsh-*（可移植）
 * 官方实现（`dsh-session-log-export` 源码逐字确认）：SessionLogDownloadController
 * 用裸 fetch 打 `new URL('/api/session.export', location.origin)` + `a[download]`
 * 触发浏览器下载。这在**官方 web** 里完全可行；只有 VS Code webview 里双重失败：
 * ① location.origin = vscode-webview://，裸 fetch 非 http 源 →「Failed to fetch」；
 * ② 即使可达，webview 禁 a[download]。
 *
 * 所以本插件只写「把这份导出交给用户」，**两侧的实现由宿主能力口挑**（见
 * `@dsh-one/dsh-plugin-kit/hostCapabilities` 的能力表）：VS Code 侧 = 扩展宿主经 loopback 代理取内容
 * 再弹保存框落盘；官方 web 侧 = 浏览器原生 fetch + 下载。插件代码两端一样，故命名
 * `dsh-*`（AGENTS.md 铁律「自有插件命名分两类」）。
 *
 * ## 机制分层（按 AGENTS.md 的优先序逐层举证）
 * - **层 1（官方槽位机制）——遮蔽（shadow）**：`conversation.session.header.utilities`
 *   是 list 槽位；官方 `@deepseek-ai/dsh-session-log-export` 在这个槽位注册的条目
 *   id 是 'session-log-download'（0.1.6-alpha.1 源码逐字）。list 槽位的条目按
 *   (priority, order) 排序、按 id 归入同一个 cell，**每个 cell 只有优先号最小的
 *   那条进渲染位**——官方注册表的原文是「the first live (non-abdicated) entry of
 *   each cell in priority order — what outlets render」（SlotCore.entriesOfSlot）。
 *   所以本插件用**同一个 id + priority -1** 注册自己的按钮：官方那条仍在注册表里
 *   （它的 `sessionLogDownload` 服务、locale 词典、`command/executed` 钩子照常存活），
 *   只是不再渲染。外观复刻官方胶囊（Button outline sm + IconDownloadOutline16）。
 * - **层 2（官方服务 API）**：导出路径用官方既有的 `/api/session.export` 路由（同一
 *   条官方路由，不改网关、不加接口）；下载动作走宿主能力口。
 * - **不再用 CSS 兜**（#87 的教训）：这条遮蔽曾经是「该 slot 内一切非自有条目
 *   display:none」的层 4 样式（理由是注册表没有 unregister-by-id 的口）。它按
 *   **位置**而不是按 **id** 生效，于是 0.1.6 新加进同一 slot 的官方 open-in-app
 *   菜单被一起摘掉（#87 的缺席根因）。list 槽位的遮蔽按 id 走注册表——同一条原则
 *   也写在 AGENTS.md 的「官方机制优先，禁 hack」里。
 */
import { createElement as h, useState } from 'react'
import { Button, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { hostCapabilities, type CapabilityContext } from '@dsh-one/dsh-plugin-kit/hostCapabilities'
import { sessionExportFileName, sessionExportPath, shouldReportExportFailure } from '../../../src/pure/sessionExport.ts'

// 自有按钮自身的样式（层 4，仅作用于自有标记）：官方胶囊的呈现由层 1 的遮蔽处理，
// 这里没有一条规则瞄准别人的元素。
const REAL_CSS = '.dshOneExport_btn{display:inline-flex;align-items:center;gap:4px}.dshOneExport_error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-left:6px}'
const CSS_TAG_ID = '@dsh-one/dsh-session-export/Export.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/dsh-session-export'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = REAL_CSS
  document.head.appendChild(tag)
}

interface ExportProps {
  /** 框架 session 作用域注入的会话 id（官方 HeaderAction 同款 prop）。 */
  sessionId?: string
  t: (key: string) => string
  /** 插件 apply 时挂上的能力口（入口组件拿不到 ctx，故随组件树注入）。 */
  capabilities: ReturnType<typeof hostCapabilities>
}

function SessionExportAction({ sessionId, t, capabilities }: ExportProps) {
  // 词典是插件自有的（ctx.locale.register('dshOneExport')），不进宿主 l10n bundle；
  // 别名一下也是仓库惯例——i18n 门禁把 src/** 里裸 t('key') 当宿主词条查。
  const tr = t
  const [error, setError] = useState<string | null>(null)
  const onClick = (): void => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    setError(null)
    void capabilities
      .downloadGatewayFile({ path: sessionExportPath(sessionId), suggestedName: sessionExportFileName(sessionId) })
      .catch((err: unknown) => {
        // 用户取消不是失败；其余失败（含宿主不可用）给用户一个明确信号。
        if (!shouldReportExportFailure((err as { code?: string }).code)) return
        setError(err instanceof Error ? err.message : String(err))
      })
  }
  return h(
    'span',
    { 'data-dshone-export': '', className: 'dshOneExport_btn' },
    h(
      Button,
      { variant: 'outline', size: 'sm', onClick },
      tr('export'),
      h(IconDownloadOutline16, { size: 12 }),
    ),
    error === null ? null : h('span', { className: 'dshOneExport_error', title: error }, tr('failed')),
  )
}

interface ExportContext extends CapabilityContext {
  effect(body: () => (() => void) | void, label?: string): void
  locale: { register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void }
  slots: {
    register(entry: unknown, component: unknown): () => void
    inject(name: string, factory: () => unknown): () => void
  }
}

/**
 * 官方同槽位条目的 id：本插件以同一个 id + priority -1 注册（层 1 遮蔽，见文件头）。
 * 出处：`@deepseek-ai/dsh-session-log-export` 0.1.6-alpha.1 的 client.js
 * `ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'session-log-download', ... })`。
 */
const OFFICIAL_ENTRY_ID = 'session-log-download'

export const inject = ['slots', 'locale']

export function apply(ctx: ExportContext): void {
  const capabilities = hostCapabilities(ctx)
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register('dshOneExport', {
      zh: { export: 'Session \u65e5\u5fd7', failed: '\u5bfc\u51fa\u5931\u8d25' },
      en: { export: 'Session log', failed: 'Export failed' },
    })
    const disposeInject = ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: OFFICIAL_ENTRY_ID,
          // 优先号 −1 < 官方条目的默认 0 → 同一个 cell 里本件上位、官方那条不渲染
          // （官方条目仍在注册表里，服务与钩子照常存活）。
          priority: -1,
          order: 1,
          locale: 'dshOneExport',
          inject: () => ({ capabilities }),
        },
        SessionExportAction,
      ),
    )
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one session export: host capability action')
}
