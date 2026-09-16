import {
  INSTALL_SCRIPT_OS_LABEL,
  INSTALL_SCRIPT_OS_ORDER,
  installCommandFor,
  installOsOrDefault,
  type HostOs,
} from './installScript.ts'

/**
 * 安装引导页的 HTML（#105 改版：居中 hero + 一键安装命令行 + 终端/编辑器分段）。
 *
 * 纯字符串拼装，不 import `vscode` 也不碰浏览器 API：宿主侧（`src/ui/installGuide.ts`）
 * 只把 l10n 文案与宿主平台喂进来，于是单测与浏览器冒烟都能直接渲染这一页
 * （宿主侧 l10n 拿不到时，冒烟给英文基线即可）。
 *
 * 命令文本由宿主按平台现算后注入（#100 的口径），页面只把平台名回给宿主。
 */

/** 页面上的全部文案（宿主侧用 `vscode.l10n.t` 填，冒烟用英文基线）。 */
export interface InstallGuideTexts {
  /** hero 大标题。 */
  heroTitle: string
  /** hero 副标题（一到两行）。 */
  heroLead: string
  /** 主按钮与下拉里的平台选择控制。 */
  installButton: string
  platformLabel: string
  copy: string
  copied: string
  copyFailed: string
  docsLink: string
  /** 分段控件两段。 */
  terminalTab: string
  editorTab: string
  /** 终端安装段：步骤逐条 + 脚本来源说明。 */
  terminalSteps: readonly string[]
  unofficialNote: string
  /** 编辑器接入段：一句说明 + 官方 dsh web 入口。 */
  editorLead: string
  editorNote: string
  openWeb: string
}

/** 下拉里的一个平台项：命令相同的平台合成一项（macOS 与 Linux 是同一条）。 */
export interface InstallPlatformItem {
  /** 该项的代表平台：页面复制时回给宿主的平台名（同组命令相同，回哪个都一样）。 */
  os: HostOs
  label: string
}

/**
 * 按 `installCommands` 的实际分叉生成平台项：相邻平台命令一样就合成一项
 * （`INSTALL_SCRIPT_OS_ORDER` 里 macOS / Linux 共用 curl 管道，因此是「macOS / Linux」
 * 一项）。命令一旦分岔，各自成项——下拉项永远等于「一条真实存在的命令」。
 */
export function installPlatformItems(): InstallPlatformItem[] {
  const items: InstallPlatformItem[] = []
  const labels: string[][] = []
  for (const os of INSTALL_SCRIPT_OS_ORDER) {
    const last = items[items.length - 1]
    if (last !== undefined && installCommandFor(last.os) === installCommandFor(os)) {
      labels[labels.length - 1].push(INSTALL_SCRIPT_OS_LABEL[os])
      continue
    }
    items.push({ os, label: '' })
    labels.push([INSTALL_SCRIPT_OS_LABEL[os]])
  }
  return items.map((item, index) => ({ os: item.os, label: labels[index].join(' / ') }))
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ---------- 图标（内联 SVG：CSP 不给外链，图标随文字色走） ---------- */

const ICON_CHEVRON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 6.2l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_CHECK =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 8.4l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_EXTERNAL =
  '<svg class="ext" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4.5h5.5V10M11.2 4.8L5.5 10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_COPY =
  '<svg class="icon-copy" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
const ICON_COPY_OK =
  '<svg class="icon-check" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.4l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
const ICON_COPY_FAIL =
  '<svg class="icon-fail" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'

const STYLE = `
      /* 整页居中、留白充足：hero 在上，安装命令行一行，下面才是分段内容。
         颜色全部走 VS Code 主题 token（背景是编辑器主题色，不是白底网页）。 */
      * { box-sizing: border-box; }
      html, body { height: 100%; }
      body {
        margin: 0;
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: 13px; line-height: 1.6;
        color: var(--vscode-foreground, #ccc);
        background: var(--vscode-editor-background, transparent);
      }
      .page {
        max-width: 720px; margin: 0 auto;
        padding: clamp(28px, 9vh, 72px) 24px 48px;
        display: flex; flex-direction: column;
      }
      .hero { text-align: center; }
      h1 {
        margin: 0 0 10px;
        font-size: 28px; line-height: 1.25; font-weight: 600;
        letter-spacing: -0.01em;
      }
      .hero-lead {
        margin: 0 auto; max-width: 34em;
        color: var(--vscode-descriptionForeground, #888);
      }
      .install { margin-top: 28px; }
      /* kimi 式一排：左侧主按钮（带下拉），右侧同行命令胶囊。窄面板下换行上下排。 */
      .install-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; }
      .picker { position: relative; flex: 0 0 auto; }
      .picker-btn {
        height: 100%; min-height: 32px;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 14px; border: 0; border-radius: 8px; cursor: pointer;
        font-family: inherit; font-size: 13px; font-weight: 500; white-space: nowrap;
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
      }
      .picker-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
      .picker-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
      .picker-btn .chev { flex: none; opacity: 0.85; }
      .menu[hidden] { display: none; }
      .menu {
        position: absolute; top: calc(100% + 6px); left: 0; z-index: 20;
        min-width: 100%; padding: 4px;
        display: flex; flex-direction: column; gap: 1px;
        background: var(--vscode-menu-background, var(--vscode-editorWidget-background, #252526));
        color: var(--vscode-menu-foreground, var(--vscode-foreground, #ccc));
        border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border, rgba(127,127,127,.35)));
        border-radius: 8px;
        box-shadow: 0 4px 16px var(--vscode-widget-shadow, rgba(0,0,0,.36));
      }
      .menu-item {
        display: flex; align-items: center; gap: 8px;
        min-height: 30px; padding: 4px 10px;
        border: 0; border-radius: 6px; cursor: pointer; text-align: left;
        font-family: inherit; font-size: 13px; white-space: nowrap;
        background: transparent; color: inherit;
      }
      .menu-item:hover, .menu-item:focus-visible {
        background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground, rgba(127,127,127,.25)));
        color: var(--vscode-menu-selectionForeground, inherit);
        outline: none;
      }
      /* 选中态用 ✓ 标出：未选中的项也留出同宽的空位，切换平台时文字不左右跳。 */
      .menu-item .tick { flex: none; width: 12px; visibility: hidden; }
      .menu-item[aria-checked="true"] .tick { visibility: visible; }
      .menu-item[aria-checked="true"] .menu-label { font-weight: 600; }
      .menu-item .menu-label { flex: 1; }
      .menu-item .ext { flex: none; opacity: 0.7; }
      .menu-sep {
        height: 1px; margin: 4px 6px;
        background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border, rgba(127,127,127,.3)));
      }
      .cmd-pill {
        flex: 1 1 300px; min-width: 0; min-height: 32px;
        display: flex; align-items: center; gap: 4px;
        padding: 2px 4px 2px 12px;
        background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background, rgba(127,127,127,.12)));
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.3)));
        border-radius: 8px;
      }
      code {
        flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: 12px; color: var(--vscode-foreground);
      }
      .icon-btn {
        flex: none; width: 26px; height: 26px; padding: 0;
        display: inline-flex; align-items: center; justify-content: center;
        border: 0; border-radius: 6px; cursor: pointer;
        background: transparent; color: var(--vscode-descriptionForeground, #888);
      }
      .icon-btn:hover {
        background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25));
        color: var(--vscode-foreground);
      }
      .icon-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
      /* 复制反馈：一个按钮三态（空闲 / 成功 ✓ / 失败 ×），颜色跟着主题走。 */
      .icon-btn svg { display: none; }
      .icon-btn[data-state="idle"] .icon-copy,
      .icon-btn[data-state="ok"] .icon-check,
      .icon-btn[data-state="fail"] .icon-fail { display: block; }
      .icon-btn[data-state="ok"] { color: var(--vscode-charts-green, #3fb950); }
      .icon-btn[data-state="fail"] { color: var(--vscode-charts-red, #f85149); }
      .fine { margin: 10px 0 0; font-size: 12px; color: var(--vscode-descriptionForeground, #888); }
      .tabs { margin-top: 32px; }
      .segmented {
        display: inline-flex; gap: 2px; padding: 2px; border-radius: 8px;
        background: var(--vscode-editorWidget-background, rgba(127,127,127,.12));
        border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(127,127,127,.25)));
      }
      .seg {
        padding: 5px 14px; border: 0; border-radius: 6px; cursor: pointer;
        font-family: inherit; font-size: 12px; font-weight: 500;
        background: transparent; color: var(--vscode-descriptionForeground, #888);
      }
      .seg:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); color: var(--vscode-foreground); }
      .seg[aria-selected="true"] {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
      }
      .seg:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; }
      .panel[hidden] { display: none; }
      .panel { padding-top: 18px; }
      .panel-lead { margin: 0; }
      .steps { margin: 0; padding: 0; list-style: none; counter-reset: step; display: flex; flex-direction: column; gap: 10px; }
      .steps li { display: flex; gap: 10px; align-items: flex-start; counter-increment: step; }
      .steps li::before {
        content: counter(step); flex: none;
        width: 20px; height: 20px; margin-top: 1px; border-radius: 50%;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; font-weight: 600;
        background: var(--vscode-badge-background, rgba(127,127,127,.25));
        color: var(--vscode-badge-foreground, var(--vscode-foreground, #ccc));
      }
      .btn-secondary {
        margin-top: 14px;
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border: 0; border-radius: 8px; cursor: pointer;
        font-family: inherit; font-size: 13px;
        background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3));
        color: var(--vscode-button-secondaryForeground, var(--vscode-foreground, #ccc));
      }
      .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.42)); }
      .btn-secondary:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
      /* 复制结果的朗读区（只在读屏里发音，不看）。 */
      .sr-only {
        position: absolute; width: 1px; height: 1px; margin: -1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
      }`

const SCRIPT = String.raw`
      const vscode = globalThis.__DSH_ONE_VSCODE__ || acquireVsCodeApi()
      const COMMANDS = __COMMANDS__
      const picker = document.getElementById('picker')
      const menu = document.getElementById('menu')
      const cmd = document.getElementById('cmd')
      const copyButton = document.getElementById('copy')
      const copyStatus = document.getElementById('copy-status')
      let selectedOs = __DEFAULT_OS__

      const applyCommand = () => {
        const text = COMMANDS[selectedOs] || ''
        cmd.textContent = text
        cmd.title = text
      }
      const selectPlatform = (os) => {
        selectedOs = os
        for (const item of menu.querySelectorAll('[data-os]')) {
          item.setAttribute('aria-checked', item.dataset.os === os ? 'true' : 'false')
        }
        applyCommand()
      }
      const setMenuOpen = (open, restoreFocus) => {
        menu.hidden = !open
        picker.setAttribute('aria-expanded', open ? 'true' : 'false')
        if (!open && restoreFocus) picker.focus()
      }
      picker.addEventListener('click', () => setMenuOpen(menu.hidden))
      menu.addEventListener('click', (event) => {
        const platform = event.target.closest('[data-os]')
        if (platform) {
          selectPlatform(platform.dataset.os)
          setMenuOpen(false, true)
          return
        }
        if (event.target.closest('[data-action="docs"]')) {
          setMenuOpen(false, true)
          vscode.postMessage({ type: 'installGuide:openDocs' })
        }
      })
      // 点下拉外部：关闭（点在页面其它地方不该留着菜单浮在上面）。
      document.addEventListener('click', (event) => {
        if (menu.hidden) return
        if (picker.contains(event.target) || menu.contains(event.target)) return
        setMenuOpen(false)
      })
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) setMenuOpen(false, true)
      })
      copyButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'installGuide:copy', os: selectedOs })
      })
      document.getElementById('open-web').addEventListener('click', () => {
        vscode.postMessage({ type: 'installGuide:openWeb' })
      })
      const tabs = [...document.querySelectorAll('[role="tab"]')]
      for (const tab of tabs) {
        tab.addEventListener('click', () => {
          for (const other of tabs) {
            const current = other === tab
            other.setAttribute('aria-selected', current ? 'true' : 'false')
            document.getElementById(other.getAttribute('aria-controls')).hidden = !current
          }
        })
      }
      window.addEventListener('message', (event) => {
        const message = event.data
        if (!message || message.type !== 'installGuide:copied') return
        copyButton.dataset.state = message.ok ? 'ok' : 'fail'
        copyStatus.textContent = message.ok ? __COPIED__ : __COPY_FAILED__
        setTimeout(() => {
          copyButton.dataset.state = 'idle'
          copyStatus.textContent = ''
        }, 2000)
      })
      applyCommand()`

/** 组装整页 HTML。`hostOs` 认不出来时默认第一项（与 #100 一致）。 */
export function installGuidePageHtml(hostOs: HostOs | undefined, texts: InstallGuideTexts): string {
  const nonce = randomNonce()
  const csp = ["default-src 'none'", `script-src 'nonce-${nonce}'`, "style-src 'unsafe-inline'"].join('; ')
  const defaultOs = installOsOrDefault(hostOs)
  const items = installPlatformItems()
  const platformButtons = items
    .map((item) => {
      const checked = item.os === defaultOs
      return `<button class="menu-item" type="button" role="menuitemradio" data-os="${item.os}" aria-checked="${checked ? 'true' : 'false'}"><span class="tick">${ICON_CHECK}</span><span class="menu-label">${escapeHtml(item.label)}</span></button>`
    })
    .join('\n            ')
  const steps = texts.terminalSteps.map((step) => `<li>${escapeHtml(step)}</li>`).join('\n          ')

  const commands: Record<string, string> = {}
  for (const os of INSTALL_SCRIPT_OS_ORDER) commands[os] = installCommandFor(os)
  const script = SCRIPT.replaceAll('__COMMANDS__', jsonForScript(commands))
    .replaceAll('__DEFAULT_OS__', jsonForScript(defaultOs))
    .replaceAll('__COPIED__', jsonForScript(texts.copied))
    .replaceAll('__COPY_FAILED__', jsonForScript(texts.copyFailed))

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>${escapeHtml(texts.heroTitle)}</title>
    <style>${STYLE}
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <h1>${escapeHtml(texts.heroTitle)}</h1>
        <p class="hero-lead">${escapeHtml(texts.heroLead)}</p>
      </section>

      <section class="install">
        <div class="install-row">
          <div class="picker">
            <button id="picker" class="picker-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="menu">
              <span>${escapeHtml(texts.installButton)}</span>${ICON_CHEVRON}
            </button>
            <div id="menu" class="menu" role="menu" aria-label="${escapeHtml(texts.platformLabel)}" hidden>
            ${platformButtons}
            <div class="menu-sep" role="separator"></div>
            <button class="menu-item" type="button" role="menuitem" data-action="docs"><span class="menu-label">${escapeHtml(texts.docsLink)}</span>${ICON_EXTERNAL}</button>
            </div>
          </div>
          <div class="cmd-pill">
            <code id="cmd"></code>
            <button id="copy" class="icon-btn" type="button" data-state="idle" aria-label="${escapeHtml(texts.copy)}" title="${escapeHtml(texts.copy)}">${ICON_COPY}${ICON_COPY_OK}${ICON_COPY_FAIL}</button>
          </div>
        </div>
        <p class="fine">${escapeHtml(texts.unofficialNote)}</p>
        <span id="copy-status" class="sr-only" role="status" aria-live="polite"></span>
      </section>

      <section class="tabs">
        <div class="segmented" role="tablist">
          <button id="tab-terminal" class="seg" type="button" role="tab" aria-selected="true" aria-controls="panel-terminal">${escapeHtml(texts.terminalTab)}</button>
          <button id="tab-editor" class="seg" type="button" role="tab" aria-selected="false" aria-controls="panel-editor">${escapeHtml(texts.editorTab)}</button>
        </div>
        <div id="panel-terminal" class="panel" role="tabpanel" aria-labelledby="tab-terminal">
          <ol class="steps">
          ${steps}
          </ol>
        </div>
        <div id="panel-editor" class="panel" role="tabpanel" aria-labelledby="tab-editor" hidden>
          <p class="panel-lead">${escapeHtml(texts.editorLead)}</p>
          <p class="fine">${escapeHtml(texts.editorNote)}</p>
          <button id="open-web" class="btn-secondary" type="button">${escapeHtml(texts.openWeb)}${ICON_EXTERNAL}</button>
        </div>
      </section>
    </main>
    <script nonce="${nonce}">${script}
    </script>
  </body>
</html>
`
}

/** 注入脚本里的字符串：`</script>` 与尖括号一律转义，命令里的引号也不破串。 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}

/** 每次渲染一个新 nonce（CSP 只放行这一次的脚本）。 */
function randomNonce(): string {
  // 纯模块不 import node:crypto（浏览器侧与冒烟也要能跑），用 Web Crypto。
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
