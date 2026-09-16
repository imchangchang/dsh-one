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
 * `./hostCapabilities.ts` 的能力表）：VS Code 侧 = 扩展宿主经 loopback 代理取内容
 * 再弹保存框落盘；官方 web 侧 = 浏览器原生 fetch + 下载。插件代码两端一样，故命名
 * `dsh-*`（AGENTS.md 铁律「自有插件命名分两类」）。
 *
 * ## 机制分层（按 AGENTS.md 的优先序逐层举证）
 * - **层 1（官方槽位机制）**：`conversation.session.header.utilities` 是 list 槽位
 *   （官方贡献 id 'session-log-download'）——追加自有贡献 id
 *   'session-log-download-dsh'（list additive，不冲突），外观复刻官方胶囊
 *   （Button outline sm + IconDownloadOutline16）。
 * - **层 2（官方服务 API）**：导出路径用官方既有的 `/api/session.export` 路由（同一
 *   条官方路由，不改网关、不加接口）；下载动作走宿主能力口。
 * - **层 4（CSS）**：官方胶囊隐藏——`[data-slot='conversation.session.header.utilities']>*:
 *   not(:has([data-dshone-export]))`，不依赖 css-module 哈希。举证：官方注册表没有
 *   unregister-by-id 的口（与设置行动同一处境），list 槽位无法只取官方那一条下来。
 */
import { createElement as h, useState } from 'react'
import { Button, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { hostCapabilities, type CapabilityContext } from './hostCapabilities.ts'
import { sessionExportFileName, sessionExportPath, shouldReportExportFailure } from '../../../pure/sessionExport.ts'

// 官方胶囊隐藏（机制层 4，举证见文件头）：框架按项给 display:contents 包装，
// :has 命中含自有标记的包装；不依赖 css-module 哈希。
// :has 只查后代不含自身——seat 项直接挂标记时须 :not([attr]) 兜自身。
const REAL_CSS = '[data-slot="conversation.session.header.utilities"]>*:not([data-dshone-export]):not(:has([data-dshone-export])){display:none!important}.dshOneExport_btn{display:inline-flex;align-items:center;gap:4px}.dshOneExport_error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-left:6px}'
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
          id: 'session-log-download-dsh',
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
