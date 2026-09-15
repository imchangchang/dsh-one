/**
 * @dsh-one/vscode-session-export——chat 树的会话日志导出自有行动（#71 验收返修）。
 *
 * 官方实现（dsh-session-log-export 源码逐字确认）：SessionLogDownloadController
 * 用裸 fetch 打 `new URL('/api/session.export', location.origin)`（HEAD 校验 +
 * GET 下载）+ `a[download]` click 触发浏览器下载。VS Code webview 里双重失败：
 * ① location.origin = vscode-webview://<id>，裸 fetch 非 http 源 →
 *   「Session 导出失败： Failed to fetch」（用户实锤文案）；
 * ② 即使 fetch 可达，webview 禁 a[download] 下载。
 * 官方无客户端改道钩子（controller 构造参数有注入缝但插件 apply 用默认实例，
 * 机制层 3 不存在）。
 *
 * 修法（机制优先序）：
 * - 机制层 1：conversation.session.header.utilities 是 list 座位（官方贡献
 *   id 'session-log-download'）——追加自有贡献 id 'session-log-download-vscode'
 *   （list additive，不冲突），外观复刻官方胶囊（Button outline sm +
 *   IconDownloadOutline16），点击 postMessage {type:'dshOne.exportSessionLog',
 *   sessionId}（统一获取点复用）；
 * - 机制层 4（举证同设置行动：list additive、registry 无 unregister-by-id 口）：
 *   官方胶囊隐藏——[data-slot='conversation.session.header.utilities']>*:
 *   not(:has([data-dshone-export]))，不依赖 css-module 哈希；
 * - 宿主（assemblyView）：收消息 → 经 mirror 拉 ZIP（读操作）→ showSaveDialog
 *   → 写盘——VS Code 里下载类动作的正确形态。
 */
import { createElement as h } from 'react'
import { Button, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'

// 官方胶囊隐藏（机制层 4，举证见文件头）：框架按项给 display:contents 包装，
// :has 命中含自有标记的包装；不依赖 css-module 哈希。
// :has 只查后代不含自身——seat 项直接挂标记时须 :not([attr]) 兜自身。
const REAL_CSS = '[data-slot="conversation.session.header.utilities"]>*:not([data-dshone-export]):not(:has([data-dshone-export])){display:none!important}.dshOneExport_btn{display:inline-flex;align-items:center;gap:4px}'
const CSS_TAG_ID = '@dsh-one/vscode-session-export/Export.css'
if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.plugin = '@dsh-one/vscode-session-export'
  tag.dataset.pluginCss = CSS_TAG_ID
  tag.textContent = REAL_CSS
  document.head.appendChild(tag)
}

const postExport = (sessionId: string): void => {
  const g = globalThis as {
    __DSH_ONE_VSCODE__?: { postMessage(msg: unknown): void }
    acquireVsCodeApi?: () => { postMessage(msg: unknown): void }
  }
  let vscode = g.__DSH_ONE_VSCODE__
  if (vscode === undefined && typeof g.acquireVsCodeApi === 'function') {
    try {
      vscode = g.acquireVsCodeApi()
      g.__DSH_ONE_VSCODE__ = vscode
    } catch {
      /* 二次 acquire throw：probe 已持有且全局缺失（不应发生） */
    }
  }
  vscode?.postMessage({ type: 'dshOne.exportSessionLog', sessionId })
}

interface ExportProps {
  /** 框架 session 作用域注入的会话 id（官方 HeaderAction 同款 prop）。 */
  sessionId?: string
  t: (key: string) => string
}

function SessionExportAction({ sessionId, t }: ExportProps) {
  const tr = t
  return h(
    'span',
    { 'data-dshone-export': '', className: 'dshOneExport_btn' },
    h(
      Button,
      {
        variant: 'outline',
        size: 'sm',
        onClick: () => {
          if (typeof sessionId === 'string' && sessionId !== '') postExport(sessionId)
        },
      },
      tr('export'),
      h(IconDownloadOutline16, { size: 12 }),
    ),
  )
}

interface ExportContext {
  effect(body: () => (() => void) | void, label?: string): void
  locale: { register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void }
  slots: {
    register(entry: unknown, component: unknown): () => void
    inject(name: string, factory: () => unknown): () => void
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: ExportContext): void {
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register('dshOneExport', {
      zh: { export: 'Session \u65e5\u5fd7' },
      en: { export: 'Session log' },
    })
    const disposeInject = ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register(
        {
          name: 'conversation.session.header.utilities',
          id: 'session-log-download-vscode',
          order: 1,
          locale: 'dshOneExport',
          inject: () => ({}),
        },
        SessionExportAction,
      ),
    )
    return () => {
      disposeInject()
      disposeLocale()
    }
  }, 'dsh-one session export: vscode save-dialog action')
}
