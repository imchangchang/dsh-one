import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { ChatSessionController } from '../server/chatSession.ts'
import {
  createSession,
  deleteWorkspace,
  executeCommand,
  exportSessionLog,
  listFileReferences,
  renameSession,
  selectModel,
  sessionAttachment,
  sessionLogZipFilename,
  sessionModels,
} from '../server/dshRpc.ts'
import type { SessionModelSelection } from '../server/dshRpc.ts'
import type { FileRefCandidate } from '../pure/fileReference.ts'
import type { ChatState, FromWebviewMessage, OutgoingImage, SessionsSnapshot, StagedFile, ToWebviewMessage } from '../pure/chatContract.ts'
import { contextMenuResource } from '../pure/contextResource.ts'
import { orderJobs } from '../pure/activityTree.ts'
import { buildSubagentTree } from '../pure/sessionTree.ts'
import { SubagentCatalogStore } from './subagentsStore.ts'
import { looksLikeSlashCommand } from '../pure/slashCommand.ts'
import type { SessionsStore } from './sessionsStore.ts'
import { JobsStore } from './jobsStore.ts'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Media type by file extension (dsh ImageMediaType: png/jpeg/webp/gif). */
const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Pushed when no session is attached; the webview renders the empty state. */
const EMPTY_STATE: ChatState = {
  sessionId: null,
  messages: [],
  pending: [],
  running: false,
  canSend: false,
}

function nonce(): string {
  return crypto.randomBytes(16).toString('base64')
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Human byte size for limit warnings, e.g. "10 MB". */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * Magic-byte sniffing for the four raster formats dsh accepts. Clipboard
 * file-promises often carry no declared MIME type, so the bytes are the only
 * reliable source (dsh itself verifies stored bytes the same way).
 */
function sniffImageMediaType(bytes: Buffer): string | undefined {
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 4) === 'GIF8') return 'image/gif'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return undefined
}

const STYLE = `
  html, body { margin: 0; padding: 0; height: 100%; overscroll-behavior-y: none; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: row; height: 100%; }
  /* 宽屏：左 sessions 面板 + 右聊天列；窄屏（<720px）改上下布局，面板限高自滚动。 */
  .chat-col {
    flex: 1; min-width: 0; display: flex; flex-direction: column;
    background: var(--vscode-editor-background, transparent);
  }
  /* 运行中：官方 dsh web StateDot(ongoing) 的 8 格像素环追逐动画，deepseek 蓝。 */
  .session-spin { display: block; color: var(--vscode-charts-blue, #5686fe); }
  .session-spin rect { fill: currentColor; opacity: 0.15; animation: session-spin-chase 1s infinite; }
  @keyframes session-spin-chase {
    0%, 12.4% { opacity: 1; }
    12.5%, 24.9% { opacity: 0.6; }
    25%, 37.4% { opacity: 0.35; }
    37.5%, to { opacity: 0.15; }
  }
  /* 头部「N 个后台任务运行中」chip 的下拉（对齐官方 JobListAction 菜单）：
     状态点 + kind 徽标 + 命令摘要 + 状态文案 + 耗时；已结束行淡化。 */
  .jobs-menu { display: flex; flex-direction: column; gap: 1px; min-width: 260px; max-width: 360px; }
  .jobs-menu-row {
    display: flex; align-items: center; gap: 8px; padding: 5px 8px;
    border-radius: 6px; font-size: 12px;
  }
  .jobs-menu-row.settled { opacity: 0.65; }
  .job-dot-slot {
    width: 10px; height: 10px; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .job-dot { width: 6px; height: 6px; border-radius: 50%; }
  .job-dot.done { background: var(--vscode-testing-iconPassed, #73c991); }
  .job-dot.warning { background: var(--vscode-editorWarning-foreground, #cca700); }
  .job-dot.error { background: var(--vscode-errorForeground, #f14c4c); }
  /* 子代理下拉的「已完成」状态点（对齐官方 ready 蓝块；运行中行用像素环）。 */
  .job-dot.settled-dot { background: var(--vscode-charts-blue, #5686fe); }
  .job-kind {
    flex: none; font-size: 10px; line-height: 16px; padding: 0 5px; border-radius: 4px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .job-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job-status {
    flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 11px; opacity: 0.75;
  }
  .job-duration { flex: none; font-size: 11px; opacity: 0.55; font-variant-numeric: tabular-nums; }
  @media (max-width: 719px) {
    #app { flex-direction: column; }
    .chat-col { min-height: 0; }
  }
  .chat-header {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 12px 8px; flex: none;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .chat-header .chat-title {
    /* 不拉伸（flex:1 会把紧跟其后的 chips 顶到行尾）：收缩自适应，
       超长才 ellipsis；chips 依次跟在文字后面。单击标题进改名。 */
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0;
    font-size: 14px; font-weight: 500; line-height: 20px; padding: 2px 4px;
    cursor: pointer; border-radius: 4px;
  }
  .chat-header .chat-title:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  /* 面包屑里的当前子代理标题：小号字（官方 .crumbSubagent 12px/18px，
     与「N 个子代理」chip 同字号），不和父会话标题同级。 */
  .chat-header .chat-title.crumb-subagent { font-size: 12px; line-height: 18px; }
  /* 面包屑（对齐官方 dsh web 的子代理进入逻辑）：父会话标题是可点链接，
     灰字常规字重（官方祖先 crumb 400，只有当前段 500），hover 提亮；
     斜杠分隔符不响应点击。 */
  .chat-header .crumb-parent {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0;
    font-size: 14px; font-weight: 400; line-height: 20px; padding: 2px 4px;
    background: transparent; border: 0; cursor: pointer;
    color: var(--vscode-descriptionForeground);
  }
  .chat-header .crumb-parent:hover { color: var(--vscode-foreground); }
  .chat-header .crumb-sep {
    flex: none; font-size: 14px; line-height: 20px; user-select: none;
    color: var(--vscode-descriptionForeground); opacity: 0.6;
  }
  /* 头部可点 chip（子代理 / 后台任务下拉）：透明底小字，hover 只提亮文字
     —— 对齐官方 SubagentHeader 的 trigger（ZKlsPq_trigger）。 */
  .header-chip {
    flex: none; display: inline-flex; align-items: center; gap: 4px;
    font-size: 12px; font-weight: 400; line-height: 18px; padding: 3px 4px;
    border: 0; border-radius: 6px; cursor: pointer;
    background: transparent;
    color: var(--vscode-descriptionForeground);
  }
  .header-chip:hover { color: var(--vscode-foreground); }
  /* 只读 preset 标签：浅底胶囊 + 14px 图标，对齐官方 AgentPresetLabel（SVAs4q_label）。 */
  .preset-chip {
    flex: none; display: inline-flex; align-items: center; gap: 4px;
    max-width: 160px; height: 22px; padding: 0 6px 0 4px;
    font-size: 12px; border-radius: 6px; overflow: hidden;
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(127,127,127,.16));
    color: var(--vscode-foreground);
  }
  .preset-chip svg { flex: none; opacity: 0.7; }
  .preset-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-header .rename-input {
    flex: 1; min-width: 0; font: inherit; font-weight: 500;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; padding: 1px 6px; outline: none;
  }
  .messages {
    flex: 1; overflow-y: auto; padding: 8px 12px;
    display: flex; flex-direction: column; gap: 10px;
    /* 双层防线（见 docs/backlog/doing/scroll-bottom-momentum-jitter.md）：
       1) 本容器（.messages）自身不产生弹性回弹——它是消息滚动容器；
       2) html/body 上也设了 overscroll-behavior-y:none——盖住 webview 根文档的
       页面级回弹（实测根层回弹 .messages 的 none 盖不住），根层被盖住后这条仍有
       意义：防 .messages 自身（若它成为滚动容器）的 rubber band 与程序滚动打架。
       非 macOS 无行为差异。 */
    overscroll-behavior-y: none;
  }
  .muted-hint { opacity: 0.6; font-size: 12px; text-align: center; }
  /* 切换会话时历史基线加载中的占位：撑满聊天列垂直居中。 */
  .loading-hint { flex: 1; display: flex; align-items: center; justify-content: center; }
  .command-notice {
    font-size: 0.9em; opacity: 0.8; white-space: pre-wrap; word-break: break-word;
    border-left: 2px solid var(--vscode-panel-border, rgba(127,127,127,.4));
    padding: 4px 10px;
  }
  .msg.user { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .msg.user .bubble {
    max-width: 85%; padding: 6px 10px; border-radius: 8px;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    white-space: pre-wrap; word-break: break-word;
  }
  /* 等待插话的气泡（官方 data-pending-steering）：降不透明度表未落地。 */
  .msg.user.steering-pending .bubble { opacity: 0.7; }
  .msg.assistant { display: flex; flex-direction: column; gap: 6px; }
  /* @会话引用（mention）：图标 + 标题，对齐 dsh web refChip——链接色、字重 500、行内 flex。 */
  .session-mention {
    display: inline-flex; align-items: center; gap: 3px; margin: 0 2px;
    padding: 0; border: none; background: none; vertical-align: baseline;
    color: var(--vscode-textLink-foreground);
    font: inherit; font-weight: 500; cursor: pointer; white-space: nowrap;
  }
  /* 给 chip 补一个带文本基线的首个 flex 项：inline-flex 容器基线原先退化为盒底边
     （第一个子项是 SVG 图标、无文本基线），导致 chip 文字相对同行正文抬高。
     content 是零宽空格（有文本基线）；margin-left 抵消 gap:3px 多出的间距。 */
  .session-mention::before { content: '​'; margin-left: -3px; }
  .session-mention svg { flex: none; }
  .session-mention:hover { text-decoration: underline; }
  /* 跨会话召回上下文行：图标与文字基线对齐。 */
  .msg.context summary svg { vertical-align: -2px; margin-right: 3px; }
  .md { line-height: 1.5; word-break: break-word; }
  .md > :first-child { margin-top: 0; }
  .md > :last-child { margin-bottom: 0; }
  .md pre {
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 8px; border-radius: 4px; overflow-x: auto;
  }
  .md code {
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em;
  }
  .md p { margin: 0 0 8px; }
  .md h1, .md h2, .md h3, .md h4, .md h5, .md h6 {
    margin: 12px 0 6px; font-weight: 600; line-height: 1.25; color: var(--vscode-foreground);
  }
  .md h1 { font-size: 1.4em; }
  .md h2 { font-size: 1.25em; }
  .md h3 { font-size: 1.15em; }
  .md h4 { font-size: 1.05em; }
  .md h5, .md h6 { font-size: 1em; }
  .md ul, .md ol { margin: 0 0 8px; padding-left: 22px; }
  .md li { margin: 2px 0; }
  .md li > ul, .md li > ol { margin-bottom: 0; }
  .md blockquote {
    margin: 0 0 8px; padding: 2px 12px; color: var(--vscode-descriptionForeground, #888);
    border-left: 3px solid var(--vscode-panel-border, rgba(127,127,127,.4));
  }
  .md blockquote > :first-child { margin-top: 0; }
  .md blockquote > :last-child { margin-bottom: 0; }
  .md a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  .md a:hover { text-decoration: underline; }
  .md img { max-width: 100%; height: auto; }
  .md hr {
    margin: 12px 0; border: 0; border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.4));
  }
  /* 表格：紧凑边框 + 表头底色，超宽横向滚动；对齐 dsh web 观感。 */
  .md table {
    display: block; width: max-content; max-width: 100%; overflow-x: auto;
    border-collapse: collapse; margin: 0 0 8px; font-size: 0.92em;
  }
  .md table th, .md table td {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35));
    padding: 4px 10px; text-align: left; vertical-align: top; border-collapse: collapse;
  }
  .md table th {
    background: var(--vscode-editorWidget-background, rgba(127,127,127,.1));
    font-weight: 600;
  }
  .md table thead th {
    border-bottom: 2px solid var(--vscode-panel-border, rgba(127,127,127,.5));
  }
  /* GFM 任务清单：checkbox + 去掉默认圆点。 */
  .md .task-list-item { list-style: none; margin-left: -18px; }
  .md input[type='checkbox'] { margin: 0 4px 0 0; vertical-align: middle; }
  .md strong { font-weight: 600; }
  /* 代码块折叠 + 复制（对齐 dsh web）：头部语言 + 复制按钮，超行数折叠成
     头部/尾部两段，中间「… 其余 N 行」切换。 */
  .md-code { margin: 6px 0; }
  .md-code-bar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; margin-bottom: 4px;
  }
  .md-code-lang {
    opacity: 0.6; font-size: 0.85em;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .md-code-copy {
    background: none; border: none; cursor: pointer; padding: 2px 6px;
    border-radius: 3px; font-size: 0.85em;
    color: var(--vscode-descriptionForeground, #888);
  }
  .md-code-copy:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25));
    color: var(--vscode-foreground);
  }
  .md-code-toggle {
    display: block; background: none; border: none; cursor: pointer;
    opacity: 0.6; margin: 2px 0; padding: 0; font-size: 0.85em;
    font-family: inherit; color: inherit;
  }
  .md-code-toggle:hover { opacity: 1; }
  .md-code pre { margin: 0; }
  .reasoning {
    border-left: 2px solid var(--vscode-panel-border, rgba(127,127,127,.4));
    padding-left: 8px; color: var(--vscode-descriptionForeground, #888); font-size: 0.9em;
  }
  .msg.context {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.25));
    border-radius: 6px; padding: 4px 10px; opacity: 0.8; font-size: 0.9em;
  }
  .msg.context summary { cursor: pointer; }
  .context-body {
    white-space: pre-wrap; word-break: break-word; margin-top: 6px;
    max-height: 300px; overflow-y: auto; opacity: 0.85;
  }
  .reasoning summary {
    cursor: pointer; opacity: 0.75; font-size: 0.9em;
    display: flex; align-items: center; gap: 5px;
    max-width: 100%;
  }
  .reasoning summary svg { flex: none; }
  /* 折叠态首行预览：ellipsis 截断不撑宽，hover 出完整文本（对齐 web ReasoningRow）。 */
  .reasoning summary .reasoning-summary {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .reasoning-body { white-space: pre-wrap; font-size: 0.9em; opacity: 0.8; margin-top: 4px; }
  /* 工具调用：行式排版（kimi-cli / dsh web 观感），不再用卡片边框容器。 */
  .tool { padding: 1px 0; font-size: 0.92em; }
  .tool-line { display: flex; align-items: baseline; gap: 6px; overflow: hidden; }
  .tool-line .spinner { align-self: center; width: 10px; height: 10px; border-width: 1.5px; }
  .tool-action { flex: none; }
  .tool-title {
    opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.95em;
  }
  /* 命令/参数预览一行：等宽、截断省略，比动作行略缩进。 */
  .tool-detail {
    opacity: 0.7; margin: 1px 0 0 20px; font-size: 0.88em;
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* 快照副本标注：fork 复制来的 subagent 调用卡（该子代理已不在本会话血缘
     树，点进去不会跳到仍运行的原子代理）。单行小字、警示色，比普通 detail
     略醒目但不撑开卡片。 */
  .tool-snapshot-note {
    margin: 2px 0 0 20px; font-size: 0.85em; font-weight: 500;
    color: var(--vscode-editorWarning-foreground, #cca700);
  }
  /* 工具失败 StateDot：dsh web 的彩色圆点（外层 10% 光晕 + 内层实心点），
     颜色按 data-state 取；done 态不渲染状态点。 */
  .tool-state-dot {
    position: relative; display: inline-block; flex: none;
    width: 8px; height: 8px; align-self: center;
  }
  .tool-state-dot::before {
    content: ""; position: absolute; inset: 0; border-radius: 50%;
    background: currentColor; opacity: 0.1;
  }
  .tool-state-dot::after {
    content: ""; position: absolute; top: 20%; right: 20%; bottom: 20%; left: 20%;
    border-radius: 50%; background: currentColor;
  }
  .tool-state-dot[data-state="error"] { color: var(--vscode-testing-iconFailed, #f14c4c); }
  /* 工具卡展开（对齐 dsh web DisclosureRow）：整行（summary）可点，折叠态保留
     摘要行，展开出 IN/OUT 卡片，内容 150px 内滚动。chevron 朝下表示可展开，
     展开后旋转朝上；展开态持久化在 detailsOpen（key 按消息/块位置）。 */
  .tool-disclosure summary {
    cursor: pointer; display: flex; flex-wrap: wrap; align-items: center; gap: 0 6px;
    list-style: none;
  }
  .tool-disclosure summary::-webkit-details-marker { display: none; }
  .tool-disclosure summary .tool-line { flex: 1; min-width: 0; }
  .tool-disclosure summary .tool-detail { flex-basis: 100%; margin: 0 0 0 20px; }
  .tool-disclosure .tool-chevron {
    flex: none; align-self: center; color: var(--vscode-descriptionForeground, #888);
    transition: transform .15s ease;
  }
  .tool-disclosure[open] .tool-chevron { transform: rotate(180deg); }
  .tool-disclosure-body { margin: 2px 0 0 20px; }
  .tool-inout { margin-top: 4px; }
  .tool-inout-label { font-size: 0.8em; font-weight: 600; opacity: 0.6; }
  .tool-inout pre {
    max-height: 150px; overflow: auto; white-space: pre-wrap; margin: 0;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 6px 8px; border-radius: 4px; font-size: 0.88em;
  }
  /* workflow 运行卡片（对齐 dsh web WorkflowRunPanel：run→phase→member 三层折叠）。
     行几何照搬官方：runHeader 32px 浅灰底圆角条、phase 32px 无底、member 24px，
     逐级缩进 16px；徽标 = StateDot（running 矩阵动画 / 终态发光圆点）。 */
  .workflow-run { width: 100%; min-width: 0; margin: 2px 0; }
  .workflow-run-header,
  .workflow-phase-header {
    display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;
    height: 32px; padding: 0 8px; border: 0; border-radius: 8px; cursor: pointer;
    background: none; color: inherit; font: inherit; text-align: left;
  }
  .workflow-run-header {
    background: var(--vscode-toolbar-background, rgba(127,127,127,.1));
  }
  .workflow-run-header:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.2)); }
  .workflow-phase-header { border-radius: 6px; }
  .workflow-phase-header:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.08)); }
  .workflow-chevron { flex: none; transition: transform .15s ease; }
  .workflow-chevron.collapsed { transform: rotate(-90deg); }
  .workflow-run-title {
    max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 14px; font-weight: 510; color: var(--vscode-foreground);
  }
  .workflow-sep {
    flex: none; width: 2px; height: 2px; border-radius: 50%;
    background: var(--vscode-descriptionForeground, #888); opacity: .6;
  }
  .workflow-run-count {
    flex: 1; min-width: 0; font-size: 12px; color: var(--vscode-descriptionForeground, #888);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .workflow-status-tail {
    flex: none; display: inline-flex; align-items: center; gap: 4px; height: 20px;
    font-size: 11px; font-weight: 510; color: var(--vscode-foreground);
  }
  .workflow-phase-list {
    display: flex; flex-direction: column; gap: 4px;
    padding: 4px 0 0 16px;
  }
  .workflow-phase-title {
    max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 14px; color: var(--vscode-foreground);
  }
  .workflow-phase-count {
    flex: 1; min-width: 0; font-size: 13px; color: var(--vscode-descriptionForeground, #888);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .workflow-phase-status {
    flex: none; width: 132px; text-align: right; font-size: 13px; color: var(--vscode-foreground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .workflow-members {
    display: flex; flex-direction: column; gap: 2px; padding-left: 16px;
  }
  .workflow-member {
    display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box;
    min-height: 24px; padding: 0 4px; border-radius: 4px;
  }
  .workflow-dot-slot {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 24px;
  }
  .workflow-member-label {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 13px; color: var(--vscode-foreground);
  }
  .workflow-member-status {
    flex: none; width: 64px; text-align: right; font-size: 13px; color: var(--vscode-foreground);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .workflow-empty { padding: 2px 4px 4px; font-size: 13px; color: var(--vscode-descriptionForeground, #888); }
  /* StateDot 发光圆点（dsh web 同款：10% 外圈晕影 + 60% 实心内点，data-state 变色）。 */
  .workflow-dot {
    position: relative; display: inline-block; flex: none;
    width: 10px; height: 10px;
  }
  .workflow-dot::before {
    content: ""; position: absolute; inset: 0; border-radius: 50%;
    background: currentColor; opacity: 0.1;
  }
  .workflow-dot::after {
    content: ""; position: absolute; top: 20%; right: 20%; bottom: 20%; left: 20%;
    border-radius: 50%; background: currentColor;
  }
  .workflow-dot[data-state="done"] { color: var(--vscode-testing-iconPassed, #73c991); }
  .workflow-dot[data-state="warning"] { color: var(--vscode-editorWarning-foreground, #cca700); }
  .workflow-dot[data-state="error"] { color: var(--vscode-errorForeground, #f14c4c); }
  /* running 态：4×4 矩阵扫描动画（官方 StateDot ongoing）。 */
  .workflow-matrix { flex: none; display: block; width: 10px; height: 10px; color: var(--vscode-charts-blue, #5686fe); }
  .workflow-matrix rect { fill: currentColor; opacity: 0.15; animation: workflow-chase 1s linear infinite; }
  @keyframes workflow-chase {
    0%, 100% { opacity: 0.15; }
    50% { opacity: 1; }
  }
  .spinner {
    width: 12px; height: 12px; border-radius: 50%; flex: none;
    border: 2px solid var(--vscode-editorWidget-border, #555);
    border-top-color: var(--vscode-progressBar-background, #0a84ff);
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  /* 工具输出：默认只渲染前几行，「共 N 行」提示行点击展开/收起（webview 侧截断）。 */
  .tool-output { margin: 2px 0 0 20px; }
  .tool-output pre {
    max-height: 320px; overflow: auto; white-space: pre-wrap; margin: 0;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 6px 8px; border-radius: 4px; font-size: 0.88em;
  }
  .tool-output-toggle {
    cursor: pointer; opacity: 0.6; margin-top: 2px; font-size: 0.85em;
  }
  .tool-output-toggle:hover { opacity: 1; }
  /* JSON 输出树（对齐 dsh web JsonTree）：对象/数组逐节点展开、箭头 toggle、逐级缩进、
     token 配色照抄官方——key/property 蓝、string 玫红、number/keyword 蓝、标点灰白、
     箭头灰。默认走官方暗色变量；VS Code 亮色主题用 body.vscode-light 反显为官方 light
     palette。 */
  .json-tree {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px; line-height: 16px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    padding: 6px 8px 8px; border-radius: 4px;
    overflow: auto; white-space: pre;
    --jt-property: #5db0d7; --jt-string: #f28b82; --jt-number: #99c8ff;
    --jt-keyword: #99c8ff; --jt-punct: #e8eaed; --jt-icon: #9aa0a6;
    --jt-ellipsis: #9aa0a6; --jt-hover: rgb(232 234 237 / 5%);
  }
  body.vscode-light .json-tree {
    --jt-property: #881391; --jt-string: #c41a16; --jt-number: #1c00cf;
    --jt-keyword: #1c00cf; --jt-punct: #202124; --jt-icon: #5f6368;
    --jt-ellipsis: #5f6368; --jt-hover: rgb(60 64 67 / 4%);
  }
  /* JsonTree 复制按钮：对齐 md-code-copy 的克制样式——右上角小「复制」按钮，
     复制整树 pretty JSON（copyPrettyJson），成功短暂变「已复制」。左缩进由上下文
     提供（消息正文=0 与 markdown code block 对齐；工具内=工具展开体的 20px）。 */
  .json-tree-shell { margin: 2px 0; }
  .json-tree-bar {
    display: flex; align-items: center; justify-content: flex-end;
    gap: 8px; margin-bottom: 2px;
  }
  .json-tree-copy {
    background: none; border: none; cursor: pointer; padding: 2px 6px;
    border-radius: 3px; font-size: 0.85em;
    color: var(--vscode-descriptionForeground, #888);
  }
  .json-tree-copy:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25));
    color: var(--vscode-foreground);
  }
  /* 节点级复制图标：行尾小图标，默认隐藏，hover 该行时出现（与容器级按钮同款克制
     灰色），点击复制该行节点的 pretty JSON；成功图标短暂换勾。 */
  .json-tree-row { position: relative; min-height: 16px; }
  .json-tree-row:hover { background: var(--jt-hover); }
  .json-tree-copy-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; margin-left: 4px; padding: 0;
    background: none; border: none; border-radius: 3px; cursor: pointer;
    color: var(--vscode-descriptionForeground, #888);
    opacity: 0; vertical-align: middle;
  }
  .json-tree-row:hover .json-tree-copy-icon { opacity: 1; }
  .json-tree-copy-icon:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25));
    color: var(--vscode-foreground); opacity: 1;
  }
  .json-tree-key { color: var(--jt-property); font-weight: 400; }
  .json-tree-label-clickable { cursor: pointer; }
  .json-tree-label-clickable:hover { text-decoration: underline; }
  .json-tree-punct { color: var(--jt-punct); }
  .json-tree-gap { display: inline-block; width: 3px; }
  .json-tree-string { color: var(--jt-string); }
  .json-tree-number { color: var(--jt-number); }
  .json-tree-keyword { color: var(--jt-keyword); }
  .json-tree-ellipsis { color: var(--jt-ellipsis); }
  .json-tree-arrow {
    display: inline-block; width: 8px; height: 16px; margin: 0;
    color: var(--jt-icon); cursor: pointer; user-select: none;
    vertical-align: middle;
  }
  .json-tree-arrow::before {
    content: ""; display: inline-block;
    width: 0; height: 0;
    border-top: 4px solid transparent; border-bottom: 4px solid transparent;
    border-left: 6px solid currentColor;
    transform: scale(.75); transform-origin: 33.333% center;
  }
  .json-tree-arrow.open::before { transform: rotate(90deg) scale(.75); }
  .json-tree-arrow:hover { color: var(--vscode-foreground); }
  .diff {
    margin-top: 4px; border-radius: 4px; overflow: hidden;
    font-family: var(--vscode-editor-font-family, monospace); font-size: 0.88em;
  }
  .diff-line { white-space: pre-wrap; padding: 0 6px; }
  .diff-line.del { background: var(--vscode-diffEditor-removedTextBackground, rgba(255,80,80,.18)); }
  .diff-line.del::before { content: '- '; }
  .diff-line.add { background: var(--vscode-diffEditor-insertedTextBackground, rgba(80,255,80,.14)); }
  .diff-line.add::before { content: '+ '; }
  /* diff 行折叠 toggle（对齐 dsh web DiffBlock「展开其余 N 行差异」）。 */
  .diff-toggle {
    cursor: pointer; opacity: 0.6; margin-top: 2px; font-size: 0.85em; padding-left: 6px;
  }
  .diff-toggle:hover { opacity: 1; }
  .streaming { opacity: 0.6; }
  .interrupted { color: var(--vscode-errorForeground, #f14c4c); font-size: 0.85em; }
  .turn-status {
    display: flex; align-items: baseline; gap: 8px;
    font-size: 0.85em;
  }
  .turn-status-text {
    /* 蓝色系扫光（对齐官方 Deep diving 的 deepseek 蓝渐变），深/浅主题通用。 */
    background: linear-gradient(
      90deg,
      #4d6bfe 0%,
      #b3c5ff 50%,
      #4d6bfe 100%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: turn-status-shimmer 1.8s linear infinite;
  }
  @keyframes turn-status-shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .turn-status-text { animation: none; }
  }
  .turn-status-clock {
    color: var(--vscode-descriptionForeground, #888);
    font-variant-numeric: tabular-nums;
  }
  .turn-error {
    display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;
    margin-top: 4px; font-size: 0.85em;
    color: var(--vscode-errorForeground, #f14c4c);
  }
  .turn-error-dot {
    width: 7px; height: 7px; border-radius: 50%; flex: none; align-self: center;
    background: var(--vscode-errorForeground, #f14c4c);
  }
  .turn-error-title { font-weight: 600; }
  .turn-error-message { opacity: 0.9; white-space: pre-wrap; }
  .turn-error-code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em; padding: 0 4px; border-radius: 3px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
  }
  .msg-actions { display: flex; align-items: center; gap: 10px; height: 28px; margin-top: 2px; }
  .msg-actions .icon-action {
    width: 28px; height: 28px; padding: 6px; display: inline-flex;
    align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
    background: transparent; border: none; border-radius: 50%; cursor: pointer;
  }
  .msg-actions .icon-action:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.17));
    color: var(--vscode-foreground, #ccc);
  }
  .msg-actions .icon-action:disabled { cursor: default; opacity: 0.4; }
  .msg-actions .icon-action.active { color: var(--vscode-foreground, #ccc); }
  .msg-actions .icon-action svg { display: block; }
  .pending {
    flex: none; padding: 6px 12px; display: flex; flex-direction: column; gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .pending-card {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35));
    border-radius: 6px; padding: 8px 10px;
    background: var(--vscode-editorWidget-background, transparent);
  }
  .pending-title { font-weight: 600; }
  .pending-reason { opacity: 0.8; font-size: 0.9em; margin-top: 2px; white-space: pre-wrap; }
  .pending-actions { display: flex; gap: 8px; margin-top: 8px; }
  .question + .question { margin-top: 10px; }
  .question-header { font-size: 0.8em; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
  .question-text { white-space: pre-wrap; }
  .question-options { display: flex; flex-direction: column; align-items: stretch; gap: 4px; margin-top: 6px; }
  .option-btn { text-align: left; display: flex; align-items: baseline; }
  .option-btn::before { content: '•'; flex: none; margin-right: 8px; opacity: 0.5; }
  .option-btn:hover:not(:disabled)::before,
  .option-btn.selected::before { opacity: 1; }
  .option-btn:hover:not(:disabled) { filter: brightness(1.2); outline: 1px solid var(--vscode-focusBorder); }
  .option-btn.selected { outline: 1px solid var(--vscode-focusBorder); }
  .question-detail { margin-top: 6px; }
  .question-detail summary { cursor: pointer; opacity: 0.75; font-size: 0.9em; }
  .question-detail .md {
    margin-top: 6px; max-height: 320px; overflow-y: auto; padding: 8px 10px;
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.25)); border-radius: 6px;
  }
  .question label.checkbox {
    display: flex; gap: 6px; align-items: baseline; margin-top: 4px; cursor: pointer;
  }
  .question input[type='text'] {
    width: 100%; box-sizing: border-box; margin-top: 6px; padding: 4px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
  }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; border-radius: 4px; padding: 4px 12px; cursor: pointer;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .input-area {
    flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px 12px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .pending + .input-area { border-top: 0; }
  .queue {
    flex: none; padding: 6px 12px; display: flex; flex-direction: column; gap: 4px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .queue-item { display: flex; align-items: baseline; gap: 8px; font-size: 0.9em; }
  .queue-tag {
    flex: none; font-size: 11px; padding: 0 6px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .queue-text {
    opacity: 0.8; overflow: hidden; text-overflow: ellipsis;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .queue-actions { display: flex; gap: 4px; flex: none; margin-left: auto; }
  .queue-actions button.link {
    background: transparent; color: var(--vscode-textLink-foreground, #4da3ff);
    padding: 0 4px; font-size: 11px; border-radius: 4px;
  }
  .queue-actions button.link:hover { text-decoration: underline; }
  .queue-editor {
    flex: 1; min-width: 0; resize: none; box-sizing: border-box; padding: 4px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; font-family: inherit; font-size: 0.9em;
  }
  /* 排队消息 >1 条时折叠成计数 header（对齐 dsh web QueueDock）：chevron +
     计数，展开才列出各条（操作入口随列表藏进展开态）。 */
  .queue-dock summary {
    display: flex; align-items: baseline; gap: 6px;
    cursor: pointer; list-style: none; user-select: none;
  }
  .queue-dock summary::-webkit-details-marker { display: none; }
  .queue-dock-count {
    flex: 1; min-width: 0; font-size: 12px; font-weight: 600; opacity: 0.8;
  }
  .queue-dock summary .queue-chevron {
    flex: none; color: var(--vscode-descriptionForeground, #888);
    transition: transform .15s ease;
  }
  .queue-dock[open] summary .queue-chevron { transform: rotate(180deg); }
  .queue-dock-list { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .queue + .input-area { border-top: 0; }
  /* 任务清单卡（对齐官方 TodoPanel/TodoDock，输入区上方 dock 栈）：头部
     「任务 N 进行中 · M 待处理」+ chevron，展开列出 todo 项（列表限高滚动）。
     chevron 是 figma 字面方向：折叠=向上、展开=向下，用 rotate 翻转。 */
  .todo-panel {
    flex: none; padding: 5px 12px 6px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .todo-panel + .input-area, .todo-panel + .queue { border-top: 0; }
  .todo-panel summary {
    display: flex; align-items: baseline; gap: 6px;
    cursor: pointer; list-style: none; user-select: none;
  }
  .todo-panel summary::-webkit-details-marker { display: none; }
  .todo-panel-title { flex: none; font-size: 12px; font-weight: 600; }
  .todo-panel-progress {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px; opacity: 0.75;
  }
  .todo-panel summary .todo-chevron {
    flex: none; color: var(--vscode-descriptionForeground, #888);
    transition: transform .15s ease;
  }
  .todo-panel[open] summary .todo-chevron { transform: rotate(180deg); }
  .todo-list {
    list-style: none; margin: 6px 0 0; padding: 0;
    max-height: 180px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
  }
  .todo-item { display: flex; align-items: baseline; gap: 7px; font-size: 12px; }
  .todo-item .todo-glyph { flex: none; align-self: center; display: inline-flex; }
  .todo-item .todo-content {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .todo-glyph-completed { color: var(--vscode-testing-iconPassed, #73c991); }
  .todo-glyph-progress { color: var(--vscode-charts-blue, #5686fe); }
  .todo-glyph-pending { color: var(--vscode-descriptionForeground, #888); }
  .todo-progress-spin {
    transform-origin: 50% 50%;
    animation: todo-progress-spin 1s linear infinite;
  }
  @keyframes todo-progress-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .todo-progress-spin { animation: none; } }
  /* 消息内 todo_write 任务卡尾部「+N」其余进行中数（对齐 web TodoRow suffix）。 */
  .tool-todo-extra { flex: none; opacity: 0.7; font-size: 0.9em; font-variant-numeric: tabular-nums; }
  .input-row { display: flex; gap: 8px; align-items: center; }
  .input-footer { display: flex; gap: 6px; align-items: center; }
  .stats-row { display: flex; align-items: center; gap: 10px; }
  .stats-row .input-stats { flex: 1; min-width: 0; }
  .input-stats {
    font-size: 11px; opacity: 0.65; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .pill {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.2));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 0; border-radius: 12px; padding: 2px 10px; font-size: 12px; line-height: 18px;
    cursor: pointer; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pill:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(127,127,127,.3)); }
  .pill .glyph { display: inline-flex; flex: none; }
  /* pill 内嵌图标 + 文字标签（如 Agent 模式）：图标不缩、标签自身省略号。 */
  .pill svg { flex: none; }
  .pill .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .popover {
    position: fixed; z-index: 20; min-width: 180px; max-width: 340px; max-height: 50vh; overflow-y: auto;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-dropdown-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    border-radius: 12px; padding: 4px;
    box-shadow: 0 0 1px 0 rgba(0,0,0,.2), 0 12px 32px 0 rgba(0,0,0,.14);
  }
  /* 菜单项几何对齐 dsh web：30px 行高、8px 圆角、左图标位 14px tertiary 色。 */
  .menu-item {
    display: flex; align-items: center; gap: 8px; min-height: 30px; box-sizing: border-box;
    padding: 4px 10px; border-radius: 8px; cursor: pointer; white-space: nowrap; font-size: 12px;
  }
  .menu-item:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .menu-item .menu-item-icon {
    flex: none; width: 14px; height: 14px; display: inline-flex;
    align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
  }
  .menu-item .menu-item-icon svg { width: 14px; height: 14px; display: block; }
  /* 选中态的 check 放菜单项尾部（dsh web 模式），仅 checked 时渲染。 */
  .menu-item .check { margin-left: auto; flex: none; }
  .menu-item .glyph { display: inline-flex; flex: none; opacity: .85; }
  .menu-item .menu-right { margin-left: auto; padding-left: 16px; opacity: .65; font-size: .9em; }
  /* agent preset 下拉项：名称 + 描述两行（描述较长，单行 menu-right 放不下）。 */
  .preset-item { align-items: flex-start; white-space: normal; }
  .preset-item .preset-item-main { flex: 1; min-width: 0; }
  .preset-item .preset-item-desc {
    margin-top: 1px; font-size: 11px; line-height: 1.4; opacity: 0.6; white-space: normal;
  }
  .preset-item .check { align-self: center; }
  .preset-item .job-dot-slot { align-self: center; }
  /* 子代理下拉的层级树（对齐 dsh web SubagentHeader 成员树）：每层嵌套容器
     左缩 16px + 4px 轨距，竖轨与横向支线用 VS Code 树缩进参考线色；末行
     竖轨半高收尾成 └。多层的祖辈竖轨随容器自然贯通。 */
  .subagent-node { position: relative; min-width: 0; }
  .subagent-node > .menu-item { position: relative; }
  .subagent-children { position: relative; margin-left: 16px; padding-left: 4px; }
  .subagent-children::before {
    content: ""; position: absolute; left: 0; top: -19px; height: 19px;
    border-left: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(127,127,127,.35));
  }
  .subagent-children > .subagent-node::before {
    content: ""; position: absolute; top: 0; bottom: 0; left: -4px;
    border-left: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(127,127,127,.35));
  }
  .subagent-children > .subagent-node:last-child::before { height: 19px; bottom: auto; }
  .subagent-children > .subagent-node > .menu-item::before {
    content: ""; position: absolute; top: 19px; left: -4px; width: 12px;
    border-top: 1px solid var(--vscode-tree-indentGuidesStroke, rgba(127,127,127,.35));
  }
  .menu-group { padding: 5px 6px 2px; font-size: .8em; opacity: .55; }
  /* 弹窗内非首个分组上方加分割线（@ 补全的「文件」「会话」分组）。 */
  .slash-popup .menu-group:not(:first-child) {
    border-top: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    margin-top: 4px; padding-top: 7px;
  }
  .menu-hint { padding: 8px; opacity: .7; }
  .slash-popup { max-height: 40vh; }
  .slash-popup .menu-item.selected { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
  .slash-popup .menu-item.hint-row { cursor: default; opacity: .75; }
  .slash-popup .menu-item.hint-row:hover { background: none; color: inherit; }
  .command-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; padding: 2px 10px; font-size: 12px; opacity: .85; }
  .command-row .command-line { font-family: var(--vscode-editor-font-family, monospace); }
  .command-row .command-text { opacity: .75; white-space: pre-wrap; word-break: break-word; }
  .command-row.error .command-text { color: var(--vscode-errorForeground, #f66); opacity: 1; }
  .command-row .spinner { align-self: center; }
  /* 多行 command 输出可展开（对齐 dsh web GenericCommandCard）：折叠态 summary
     一行显示命令名 + 输出首行，展开显示全文。 */
  .command-detail { min-width: 0; flex: 1 1 auto; }
  .command-detail summary {
    display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap;
    cursor: pointer; list-style: none; user-select: none;
  }
  .command-detail summary::-webkit-details-marker { display: none; }
  .command-detail summary .command-line { flex: none; }
  .command-detail summary .command-text {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .command-detail .command-body {
    white-space: pre-wrap; word-break: break-word; opacity: .75;
    margin-top: 2px; padding: 6px 8px; border-radius: 4px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15));
    font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;
  }
  .command-row.error .command-body { color: var(--vscode-errorForeground, #f66); opacity: 1; }
  .context-bar {
    flex: none; width: 72px; height: 14px; padding: 0 2px; border: 0; background: none; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .context-bar-track {
    display: block; width: 100%; height: 6px; border-radius: 3px; overflow: hidden;
    border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.55));
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.2));
    box-sizing: border-box;
  }
  .context-bar-fill {
    display: block; height: 100%; min-width: 2px; border-radius: 2px;
    background: var(--vscode-progressBar-background, var(--vscode-button-background));
    transition: width .18s ease, background-color .18s ease;
  }
  /* 切换模型后窗口未知：灰字占位（明确是非误报的未知状态），高度与正常 bar 一致防跳变。 */
  .context-bar.level-unknown {
    font-size: 10px; line-height: 14px; color: var(--vscode-descriptionForeground, #888); white-space: nowrap;
  }
  /* 余量分级变色（src/pure/contextMeter.ts）：充足显式绿，<10 轮黄，<5 轮/超窗口红。 */
  .context-bar.level-ok .context-bar-fill { background: var(--vscode-testing-iconPassed, #73c991); }
  .context-bar.level-warn .context-bar-fill { background: var(--vscode-editorWarning-foreground, #cca700); }
  .context-bar.level-danger .context-bar-fill,
  .context-bar.level-overflow .context-bar-fill { background: var(--vscode-errorForeground, #f14c4c); }
  .context-bar.level-overflow .context-bar-track { border-color: var(--vscode-errorForeground, #f14c4c); }
  .context-panel { width: 240px; font-size: 12px; line-height: 20px; }
  .context-panel .cp-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .context-panel .cp-percent { font-weight: 600; }
  .context-panel .cp-figures { font-variant-numeric: tabular-nums; opacity: .95; flex: none; }
  /* 「窗口未知」面板说明行：中性灰（非错误红），与占位一致。 */
  .context-panel .cp-unknown {
    margin-top: 8px; font-size: 12px; line-height: 1.5;
    color: var(--vscode-descriptionForeground, #888);
  }
  .context-panel .cp-bar {
    display: flex; gap: 1px; height: 6px; margin: 10px 0 8px; border-radius: 3px;
    border: 1px solid var(--vscode-widget-border, rgba(127,127,127,.55));
    overflow: hidden; background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.2));
    box-sizing: border-box;
  }
  .context-panel .cp-seg { height: 100%; min-width: 2px; border-radius: 1px; }
  .context-panel .cp-row { display: flex; align-items: center; gap: 6px; padding: 2px 0; }
  .context-panel .cp-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }
  .context-panel .cp-value { margin-left: auto; font-variant-numeric: tabular-nums; opacity: .95; flex: none; }
  /* 实时预估行（≈N/轮，约还可持续 M 轮）。 */
  .context-panel .cp-estimate { margin-top: 10px; font-size: 11px; opacity: 0.7; }
  /* 超出当前模型窗口的红色提示行。 */
  .context-panel .cp-overflow {
    margin-top: 8px; font-size: 12px; line-height: 1.5;
    color: var(--vscode-errorForeground, #f14c4c);
  }
  .image-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .image-chip {
    display: inline-flex; align-items: center; gap: 6px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
    border-radius: 10px; padding: 2px 4px 2px 8px; font-size: 12px;
    max-width: 200px;
  }
  .image-chip .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .image-chip .chip-remove {
    background: transparent; color: inherit; border: 0; padding: 0 4px;
    cursor: pointer; font-size: 12px; line-height: 1; opacity: 0.8;
  }
  .image-chip .chip-remove:hover { opacity: 1; }
  /* 文件 chip 的类型小图标（strokeSvg 固定 14px，缩到容器尺寸）。 */
  .file-chip-icon { display: inline-flex; width: 12px; height: 12px; flex: none; }
  .file-chip-icon svg { width: 12px; height: 12px; display: block; }
  /* 待发送图片缩略图（对齐官方 AttachmentRail：方图 cover，hover 右上角出移除钮）。 */
  .attach-thumb {
    position: relative; width: 48px; height: 48px; flex: none;
    border-radius: 10px; overflow: hidden; cursor: zoom-in;
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35));
    background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12));
  }
  .attach-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attach-thumb .thumb-remove {
    position: absolute; top: 3px; right: 3px; z-index: 1;
    width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    cursor: pointer; font-size: 12px; line-height: 1;
    opacity: 0; transition: opacity .2s ease-in-out;
  }
  .attach-thumb:hover .thumb-remove, .attach-thumb .thumb-remove:focus-visible { opacity: 1; }
  @media (pointer: coarse) { .attach-thumb .thumb-remove { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .attach-thumb .thumb-remove { transition: none; } }
  #input {
    flex: 1; resize: none; box-sizing: border-box; padding: 6px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px;
    font-family: inherit; font-size: inherit; max-height: 160px;
  }
  #input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .send-button { flex: none; }
  .msg-images { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  /* 消息图片缩略图复用 .attach-thumb 方图；加载中的占位方块居中省略号。 */
  .msg-thumb-loading {
    display: inline-grid; place-items: center; cursor: wait;
    color: var(--vscode-descriptionForeground, rgba(127,127,127,.8));
  }
  .msg-image-chip { cursor: zoom-in; padding-right: 8px; }
  .msg-image-chip:hover { filter: brightness(1.15); }
  .jump-latest {
    position: sticky; bottom: 4px; align-self: flex-end; flex: none;
    margin-bottom: -30px; z-index: 5;
    border-radius: 14px; padding: 4px 12px; font-size: 12px;
    background: var(--vscode-editorWidget-background, var(--vscode-button-secondaryBackground, rgba(127,127,127,.3)));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.35));
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
  }
  .jump-latest:hover { filter: brightness(1.1); }
  /* 消息流顶部的「加载更早」入口（对齐官方 dsh web ChatView 的分页按钮）。 */
  .older { display: flex; justify-content: center; }
  .older button {
    background: transparent; color: var(--vscode-descriptionForeground, #888);
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    border-radius: 12px; padding: 3px 12px; font-size: 12px;
  }
  .older button:hover:not(:disabled) { color: var(--vscode-foreground); }
  .lightbox {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 30; cursor: zoom-out;
  }
  .lightbox img { max-width: 95%; max-height: 95%; }
  .empty {
    flex: 1; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 8px; padding: 24px; text-align: center;
  }
  .empty-title { font-weight: 600; }
  .empty-hint { opacity: 0.7; font-size: 0.9em; }
  .empty button { margin-top: 8px; padding: 4px 14px; }
  /* 空会话 hero（官方 dsh web 空态 HeroShell，pXSMma_*）：整列水平居中。 */
  .hero {
    flex: 1; min-height: 0; overflow-y: auto;
    display: flex; flex-direction: column; justify-content: center; padding: 24px;
  }
  .hero-stack {
    width: 100%; max-width: 780px; margin: 0 auto;
    display: flex; flex-direction: column; gap: 12px;
  }
  .hero-headline {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    color: var(--vscode-foreground);
  }
  /* 品牌鱼标（官方 FishLogo SVG）：居中、主题蓝色，左右缓游的轻量动画——
     只动 transform（合成层，不触发布局），空态加载零额外成本；
     prefers-reduced-motion 下静止。 */
  .hero-fish {
    align-self: center;
    color: var(--vscode-textLink-foreground, #4da3ff);
    animation: hero-fish-swim 4.8s ease-in-out infinite;
  }
  @keyframes hero-fish-swim {
    0%, 100% { transform: translateX(-8px) rotate(-3deg); }
    50% { transform: translateX(8px) rotate(3deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .hero-fish { animation: none; }
  }
  .hero-headline-text { font-size: 26px; font-weight: 500; line-height: 32px; }
  .hero-badge {
    align-self: flex-start; margin-top: 4px; white-space: nowrap;
    font-size: 12px; font-weight: 500; line-height: 18px; padding: 1px 7px 0;
    border-radius: 24px;
    color: var(--vscode-textLink-foreground, #4da3ff);
    border: 1px solid var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25));
    background: var(--vscode-editor-inactiveSelectionBackground, rgba(90,140,255,.12));
  }
  .hero-chips { display: flex; align-items: center; gap: 4px; padding-left: 8px; }
  .hero-chip {
    display: inline-flex; align-items: center; gap: 4px; min-height: 28px;
    max-width: 360px; padding: 0 8px; border: 0; border-radius: 16px;
    background: transparent; color: var(--vscode-foreground);
    font-size: 13px; font-weight: 500; line-height: 20px;
  }
  .hero-chip .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hero-chip svg { flex: none; }
  .hero-chip svg.chevron { color: var(--vscode-descriptionForeground); }
  button.hero-chip { cursor: pointer; }
  button.hero-chip:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.18));
  }
  /* hero 里的 composer 大圆角卡片（官方 uV2eYG_card：22px 圆角 + 浮层底 +
     柔和双层阴影；深色主题下 editorWidget 底即浮层提亮，阴影近似不可见）。 */
  .hero .input-area {
    gap: 8px; padding: 10px 12px 8px;
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    border-radius: 22px;
    background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    box-shadow: 0 4px 12px rgba(0,0,0,.02), 0 2px 8px rgba(0,0,0,.04);
  }
  .hero #input {
    background: transparent; border-color: transparent;
    font-size: 16px; line-height: 24px;
  }
  .hero #input:focus { outline: none; }
`

function chatHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const n = nonce()
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'chatWebview.js'))
  // Same CSP discipline as ui/webview.ts: nonce-gated scripts, no remote resources.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${n}'`,
    // Message attachments render as data: URLs fetched via session.attachment.
    "img-src data:",
  ].join('; ')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${STYLE}</style>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${escapeHtml(scriptUri.toString())}"></script>
</body>
</html>`
}

/** 一个会话 tab 的全部状态：panel（可被用户关闭）+ controller（服务重启前
 * 常驻）+ 各自的订阅。关闭 tab 只置空 panel 与面板侧订阅；controller 与
 * controllerSub 保留（pending 兜底再拉出、重开复用）。 */
interface ChatTab {
  /** 附着会话 id；null = 空态 tab（服务未就绪/无会话可挂）。 */
  sessionId: string | null
  /** 编辑器 tab（用户关闭后为 null）。 */
  panel: vscode.WebviewPanel | null
  /** 会话控制器（服务 down/重启后为 null，恢复时重建）。 */
  controller: ChatSessionController | null
  /** controller 状态订阅；tab 关闭后保留（pending 兜底需要继续听）。 */
  controllerSub: vscode.Disposable | null
  /** panel 消息订阅（panel 侧，随 panel 关闭清理）。 */
  msgSub: vscode.Disposable | null
  /** panel 活动状态订阅（随 panel 关闭清理）。 */
  viewStateSub: vscode.Disposable | null
  /** Last title projection seen from the attached session (auto-rename watch). */
  lastSessionTitle: string | undefined
  /**
   * 右键「发送到当前会话」暂存的附件：webview 尚未解析（用户还没打开过
   * 这个会话的 tab）时先落这两个队列，tab 打开后再投给 composer。只活到
   * 下一次 flush——成功后清空，不跨会话堆积（per-tab）。
   */
  pendingStagedFiles: StagedFile[]
  pendingStagedImages: OutgoingImage[]
}

/**
 * Chat editor tabs（`dshOne.chatPanel`）：**一个会话一个 tab**——每个打开的
 * 会话持有自己的 ChatSessionController 与 WebviewPanel，ChatState 快照按
 * session 分桶推送、用户动作按 tab 路由，互不串台。会话列表不在编辑器里
 * （已拆到侧栏原生 tree）；宿主仍向每个 panel 的 webview 推 SessionsStore
 * 快照，因为 composer 的 @-mention 补全读它。tab 懒创建（点会话 / 新建 /
 * open 命令 / 发送文件），默认 ViewColumn.Active（当前活动编辑器列，用户
 * 决策：不自动分栏）。用户关闭 tab 时 controller 保留——pending 交互兜底
 * 再拉出与重开即复用都依赖它；服务重启时统一释放，只恢复活动的会话 tab。
 * 头部信息区的 chips（后台任务 / 子代理）数据来自 JobsStore（mux 全局
 * session/jobs 帧，含已结束的 job）与 store 的 session.list 基线，经
 * composeHeader 合成 ChatState.backgroundJobs / runningSubagents 随 state
 * 推送（JobsStore/store 变更与 tab 附着切换时重推）。
 * With no session — or a non-running server — the webview gets EMPTY_STATE
 * and shows its placeholder copy.
 */
export class ChatViewProvider implements vscode.Disposable {
  /** 一个会话一个 tab：panel + controller + 各自的订阅。panel 可被用户关闭
   * （置 null，controller 保留——pending 兜底再拉出、重开复用）。 */
  private readonly tabs = new Map<string, ChatTab>()
  /** 空态 tab 的 map key（sessionId 为 null 的占位 tab，无 controller）。 */
  private static readonly EMPTY_TAB_KEY = '\u0000empty'
  /** 高亮会话变化时通知侧栏刷新（拆分解耦：侧栏读 activeSessionId）。 */
  private readonly activeEmitter = new vscode.EventEmitter<string | null>()
  /** Fired when activeSessionId changes (活动 tab 切换/关闭). */
  readonly onActiveSessionChanged = this.activeEmitter.event
  /** 最近一次活动 tab 的会话（服务重启后只恢复它）。 */
  private lastActiveSessionId: string | null = null
  /** 服务重启后待恢复的会话（等 store 基线刷新确认还在，再 openSession）。 */
  private pendingRestoreSessionId: string | null = null
  /** 当前服务的 url（null = 未运行）；url 变化 = 新服务进程（重启）。 */
  private lastUrl: string | null = null
  private readonly managerSub: vscode.Disposable
  private readonly storeSub: vscode.Disposable
  private readonly jobs: JobsStore
  private readonly jobsSub: vscode.Disposable
  /** 子代理目录数据层（subagent.list）：菜单行显示名的来源（descriptor label）。 */
  private readonly subagents: SubagentCatalogStore
  private readonly subagentsSub: vscode.Disposable

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly extensionUri: vscode.Uri,
    private readonly store: SessionsStore,
    /** Fired after a chat-initiated session mutation (e.g. rename) so the store can rebuild. */
    private readonly onSessionsChanged?: () => void,
  ) {
    this.managerSub = manager.onDidChangeState((s) => this.onServerState(s))
    this.storeSub = store.onDidChange(() => {
      this.pushSessions()
      // 服务重启后待恢复的活动会话：等基线刷新确认还在，再重新打开它的 tab。
      if (this.pendingRestoreSessionId && this.store.hasSession(this.pendingRestoreSessionId)) {
        const target = this.pendingRestoreSessionId
        this.pendingRestoreSessionId = null
        this.openSession(target)
      }
      // 聊天头部的「N 个子代理」chip 来自 session.list 基线（子代理开跑/收尾
      // 触发 host 事件 → store 刷新），每个附着 tab 重推一次 state。
      for (const tab of this.tabs.values()) {
        const controller = tab.controller
        if (!controller) continue
        // 中继服务端 running 位（session-status 增量随 store 变更到达）。
        controller.setServerRunning(this.store.runningFor(controller.sessionId))
        this.push(tab, controller.getState())
        // 子代理目录随基线变化重拉：新子代理 spawn 让子树签名变化，菜单行
        // 显示名即时更新（不会只靠异步 title 兜底）。
        this.subagents.ensure(controller.sessionId, store.rawList())
      }
    })
    this.jobs = new JobsStore(manager, logger)
    // 头部「N 个后台任务」chip 的数据源（mux 全局 session/jobs 帧）：
    // 基线变化时重推所有附着 tab 的 state，composeHeader 重新组合下拉行。
    this.jobsSub = this.jobs.onDidChange(() => {
      for (const tab of this.tabs.values()) {
        if (tab.controller) this.push(tab, tab.controller.getState())
      }
    })
    this.subagents = new SubagentCatalogStore(manager, logger)
    // 子代理目录拉到后重推 state，composeHeader 用最新的 descriptor label
    // 重组成下拉行（初次 attach 时 label 可能还没到，先回退 title/id）。
    this.subagentsSub = this.subagents.onDidChange(() => {
      for (const tab of this.tabs.values()) {
        if (tab.controller) this.push(tab, tab.controller.getState())
      }
    })
  }

  /** 当前活动 tab 附着的会话（无活动 chat tab 或服务未运行 → null）。 */
  get currentSessionId(): string | null {
    const tab = this.activeTab()
    return tab?.controller ? tab.sessionId : null
  }

  /** 是否还有打开的 chat tab。 */
  get isOpen(): boolean {
    return this.tabs.size > 0
  }

  /**
   * 侧栏高亮的会话：当前活动 chat tab 的会话（多 tab 时高亮跟随活动编辑器；
   * 无活动 chat tab → null，用户决策：所有 tab 关闭后不高亮任何会话；服务
   * down 时 controller 释放，同样回落 null——与单面板时代行为一致）。
   */
  get activeSessionId(): string | null {
    const tab = this.activeTab()
    return tab?.controller ? tab.sessionId : null
  }

  /**
   * 当前活动 chat tab 真实附着的会话（tab 开着且附着才非 null）。侧栏
   * 「已打开会话单击 = 行内重命名」的判定用它：活动 tab 的会话点侧栏
   * 行是改名，其他会话（含已开非活动的）都是打开/聚焦。
   */
  get attachedSessionId(): string | null {
    const tab = this.activeTab()
    return tab?.panel && tab.controller ? tab.sessionId : null
  }

  /** 所有已附着（有 controller）的会话 id——extension 的归档/清理遍历用。 */
  openSessionIds(): string[] {
    const ids: string[] = []
    for (const tab of this.tabs.values()) {
      if (tab.controller && tab.sessionId) ids.push(tab.sessionId)
    }
    return ids
  }

  /** 把当前打开的会话集合同步给 store（完成标记排除打开中的会话）。 */
  private syncAttachedSessions(): void {
    const ids: string[] = []
    for (const tab of this.tabs.values()) {
      if (tab.panel && tab.sessionId) ids.push(tab.sessionId)
    }
    this.store.setAttachedSessions(ids)
  }

  /**
   * 打开一个会话（侧栏点击 / 聊天内跳转 / 新建会话）：**默认在当前活动
   * chat tab 打开**（替换该 tab 的会话，用户决策）——已有该会话的 tab 则
   * 聚焦它（一个会话一个 tab，不复制）；没有活动 chat tab（焦点在文件或
   * 没有 chat tab）时新建 tab。非运行中的服务：已有 tab 显示空态，没有则
   * 开空态 tab（服务恢复后自动重开活动会话）。
   */
  openSession(sessionId: string): void {
    if (!sessionId) return
    // 显式打开（侧栏/命令/恢复）都会带出会话，挂起的重启恢复目标作废。
    this.pendingRestoreSessionId = null
    const existing = this.tabs.get(sessionId)
    if (existing) {
      if (!existing.controller) this.attachController(existing, sessionId)
      if (!existing.panel) {
        // 用户关过这个 tab：重建 panel（复用保留的 controller）。
        this.ensurePanel(existing)
      } else {
        this.revealTab(existing)
      }
      // 打开（聚焦）即视为已读。
      this.store.setUnread(sessionId, false)
      return
    }
    const active = this.activeTab()
    if (active) {
      // 有活动 chat tab：默认在当前 tab 打开（替换该 tab 的会话）。
      this.replaceTabSession(active, sessionId)
      return
    }
    // 没有活动 chat tab → 新建 tab（原「总是新建」路径）。
    this.openSessionInNewTab(sessionId)
  }

  /**
   * 显式「在新 tab 中打开」（侧栏菜单/命令）：总是新建一个 tab；该会话
   * 已有 tab 则聚焦它（不复制）。非运行中的服务开空态 tab。
   */
  openSessionInNewTab(sessionId: string): void {
    if (!sessionId) return
    this.pendingRestoreSessionId = null
    const existing = this.tabs.get(sessionId)
    if (existing) {
      if (!existing.controller) this.attachController(existing, sessionId)
      if (!existing.panel) {
        this.ensurePanel(existing)
      } else {
        this.revealTab(existing)
      }
      this.store.setUnread(sessionId, false)
      return
    }
    const status = this.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (!url) {
      // 与单面板时代一致：服务没起来点会话也有反馈——打开（或聚焦）空态
      // tab 显示安装引导/hero，等服务恢复（自动重开活动会话）。
      this.logger.warn(`chat: openSessionInNewTab(${sessionId}) ignored — server not running`)
      const empty = this.tabs.get(ChatViewProvider.EMPTY_TAB_KEY)
      if (empty) {
        this.revealTab(empty)
      } else {
        const tab = this.createTab(null)
        this.revealTab(tab)
      }
      return
    }
    // 打开（附着）即视为已读。
    this.store.setUnread(sessionId, false)
    const tab = this.createTab(sessionId)
    this.attachController(tab, sessionId)
    this.revealTab(tab)
  }

  /**
   * 把当前活动 tab 的内容换成目标会话（「在当前 tab 打开」）：旧会话的
   * controller 与订阅释放（等同单面板时代切换会话），暂存附件清空（不投给
   * 别的会话），tab 的 panel/消息订阅复用。
   */
  private replaceTabSession(tab: ChatTab, sessionId: string): void {
    const oldKey = tab.sessionId ?? ChatViewProvider.EMPTY_TAB_KEY
    tab.controllerSub?.dispose()
    tab.controllerSub = null
    tab.controller?.dispose()
    tab.controller = null
    tab.pendingStagedFiles = []
    tab.pendingStagedImages = []
    tab.lastSessionTitle = undefined
    if (this.tabs.get(oldKey) === tab) this.tabs.delete(oldKey)
    tab.sessionId = sessionId
    this.tabs.set(sessionId, tab)
    this.attachController(tab, sessionId)
    if (!tab.controller) {
      // 服务没起来附着失败：tab 显示空态（旧会话内容已释放，不能残留）。
      this.push(tab, this.emptyState())
      this.syncPanelTitle(tab)
    }
    this.store.setUnread(sessionId, false)
    this.revealTab(tab)
    this.syncAttachedSessions()
  }

  /**
   * 打开（或揭示）聊天 editor tab。已有 tab 时聚焦活动的那个（无活动则
   * 第一个）；一个都没有时打开当前 workspace 最新会话的 tab（贴合现状的
   * 「打开面板即见最新会话」），无会话则开空态 tab（安装引导/hero）。
   */
  openPanel(): void {
    const active = this.activeTab()
    if (active) {
      this.revealTab(active)
      return
    }
    // 焦点不在 chat tab：优先回退最近活动过的会话 tab，其次第一个。tab 被
    // 用户关过（panel null、controller 保留）的，重建 panel。
    const last = this.lastActiveSessionId ? (this.tabs.get(this.lastActiveSessionId) ?? null) : null
    const fallback = last ?? (this.tabs.values().next().value as ChatTab | undefined)
    if (fallback) {
      if (!fallback.panel) this.ensurePanel(fallback)
      else this.revealTab(fallback)
      return
    }
    const latest = this.store.latestCurrentSessionId()
    const status = this.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (latest && url) {
      this.openSession(latest)
      return
    }
    const tab = this.createTab(null)
    this.revealTab(tab)
  }

  /**
   * 关闭一个会话的 tab（归档/删除后清理）：panel 销毁 + controller 释放 +
   * 订阅全部解除。活动 tab 被关时侧栏高亮自动重算。
   */
  closeSession(sessionId: string): void {
    const tab = this.tabs.get(sessionId)
    if (!tab) return
    this.disposeTab(tab)
    this.recomputeActive()
    this.pushSessions()
  }

  /** EMPTY_STATE plus the startup-failure marker when the server is in error. */
  private emptyState(): ChatState {
    const status = this.manager.getStatus()
    return status.state === 'error' && status.reason === 'dshNotFound'
      ? { ...EMPTY_STATE, serverError: 'dshNotFound' }
      : EMPTY_STATE
  }

  /** 当前活动的 chat tab（panel.active），无则 null。 */
  private activeTab(): ChatTab | null {
    for (const tab of this.tabs.values()) {
      if (tab.panel?.active) return tab
    }
    return null
  }

  /** 活动 tab 变化后重算高亮并通知侧栏（tab 聚焦/关闭/重建时调用）。 */
  private recomputeActive(): void {
    const active = this.activeTab()
    // lastActiveSessionId 只认「活动过」（含服务 down 时 controller 已释放
    // 但 tab 还开着的情况）——重启恢复、发送文件回退都靠它。
    if (active?.sessionId) this.lastActiveSessionId = active.sessionId
    // 高亮值要求 controller 在（服务 down 时回落 null）。
    this.activeEmitter.fire(active?.controller ? active.sessionId : null)
    this.pushSessions()
  }

  /** 新建一个 tab（panel 骨架 + 消息/视图状态订阅）；随后通常 attachController。 */
  private createTab(sessionId: string | null): ChatTab {
    const panel = vscode.window.createWebviewPanel(
      'dshOne.chatPanel',
      'DSH One',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
        // 保留隐藏时的 webview 上下文：tab 切走再切回不重载页面，聊天内容、
        // 草稿、滚动位置原样保留（与 dshOne.tab 的 openInTab 对齐）。即使
        // 极端情况下仍被重载，webview 的 ready 报到也会让宿主重推状态。
        retainContextWhenHidden: true,
      },
    )
    // tab 图标用 dsh 官方品牌图标（assets/dsh-favicon.svg，拷自已安装的
    // @deepseek-ai/dsh-web-frontend/dist/favicon.svg；iconPath 是宿主层行为，
    // 无需把 assets 加进 localResourceRoots）。
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'dsh-favicon.svg')
    panel.webview.html = chatHtml(panel.webview, this.extensionUri)
    const tab: ChatTab = {
      sessionId,
      panel,
      controller: null,
      controllerSub: null,
      msgSub: null,
      viewStateSub: null,
      lastSessionTitle: undefined,
      pendingStagedFiles: [],
      pendingStagedImages: [],
    }
    // 消息按 tab 路由：闭包捕获本 tab，动作落在它的 controller 上，回复
    // 都 post 回本 tab 的 webview（互不串台）。
    tab.msgSub = panel.webview.onDidReceiveMessage((m: FromWebviewMessage) => void this.onMessage(tab, m))
    // 活动 tab 检测：聚焦/失焦都重算高亮（侧栏跟随活动编辑器）。
    tab.viewStateSub = panel.onDidChangeViewState(() => this.recomputeActive())
    panel.onDidDispose(() => {
      // 用户关闭 tab：panel 侧订阅随 panel 自动清理，引用置空；controller
      // 保留——pending 交互兜底再拉出、重开即复用都依赖它（与单面板时代
      // 一致）。activeSessionId 由 recomputeActive 重算，侧栏高亮跟随。
      if (this.tabs.get(tab.sessionId ?? ChatViewProvider.EMPTY_TAB_KEY) === tab) {
        tab.panel = null
        tab.msgSub = null
        tab.viewStateSub = null
      }
      this.recomputeActive()
    })
    this.tabs.set(sessionId ?? ChatViewProvider.EMPTY_TAB_KEY, tab)
    this.push(tab, this.emptyState())
    this.syncPanelTitle(tab)
    this.syncAttachedSessions()
    this.pushSessions()
    return tab
  }

  /** 给已有 tab 附着（或重建）controller（首次打开、服务重启恢复共用）。 */
  private attachController(tab: ChatTab, sessionId: string): void {
    const status = this.manager.getStatus()
    const url = status.state === 'running' && status.url ? status.url : null
    if (!url) return
    if (tab.controller) {
      // 已附着：可能还差 push 初始状态（tab 骨架刚建时 controller 为 null，
      // 不会走到这里；走到说明重复调用，幂等处理）。
      return
    }
    const controller = new ChatSessionController(url, sessionId, this.logger)
    tab.sessionId = sessionId
    tab.controller = controller
    // 附着即取一次服务端 running 位（基线未覆盖时为 undefined，controller
    // 内部回退 mux 折叠值）；之后随 store 变更中继。
    controller.setServerRunning(this.store.runningFor(sessionId))
    tab.controllerSub = controller.onDidChange((state) => {
      this.push(tab, state)
      // 兜底：tab 被用户关闭但有 pending 交互（审批/问题/计划评审）时自动
      // 再拉出该会话的 tab，避免交互被静默吞掉（per-session）。
      if (state.pending.length > 0 && !tab.panel) this.ensurePanel(tab)
      // dsh 自动命名经会话内的 title 投影到达，host 事件流没有对应事件，
      // sessions 面板不会自己刷新——标题变化时主动重拉一次基线，并同步
      // 编辑器 tab 标题（标题投影即 tab 标题源，含用户重命名）。
      if (state.sessionTitle !== tab.lastSessionTitle) {
        tab.lastSessionTitle = state.sessionTitle
        void this.store.refresh()
        this.syncPanelTitle(tab)
      }
    })
    // 附着即拉取该会话子代理子树的目录（label 描述符），菜单行显示名会随
    // onDidChange 重推时更新；首次 attach 时可能还没到，先走 title/id 回退。
    this.subagents.ensure(sessionId, this.store.rawList())
    tab.lastSessionTitle = controller.getState().sessionTitle
    this.push(tab, controller.getState())
    // tab 标题随附着会话同步（含空态回落「DSH One」；标题投影的后续更新由
    // controller.onDidChange 里的 syncPanelTitle 跟进）。
    this.syncPanelTitle(tab)
  }

  /** 用户关闭 tab 后 pending 交互到来：重建该 tab 的 panel（复用 controller）。 */
  private ensurePanel(tab: ChatTab): void {
    if (tab.panel) return
    const panel = vscode.window.createWebviewPanel(
      'dshOne.chatPanel',
      tab.sessionId ? `会话 ${tab.sessionId.slice(0, 8)}` : 'DSH One',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
        retainContextWhenHidden: true,
      },
    )
    panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'assets', 'dsh-favicon.svg')
    panel.webview.html = chatHtml(panel.webview, this.extensionUri)
    tab.panel = panel
    tab.msgSub = panel.webview.onDidReceiveMessage((m: FromWebviewMessage) => void this.onMessage(tab, m))
    tab.viewStateSub = panel.onDidChangeViewState(() => this.recomputeActive())
    panel.onDidDispose(() => {
      if (this.tabs.get(tab.sessionId ?? ChatViewProvider.EMPTY_TAB_KEY) === tab) {
        tab.panel = null
        tab.msgSub = null
        tab.viewStateSub = null
      }
      this.recomputeActive()
    })
    this.push(tab, tab.controller?.getState() ?? this.emptyState())
    this.syncPanelTitle(tab)
    this.syncAttachedSessions()
    this.pushSessions()
    this.revealTab(tab)
  }

  /** 聚焦一个 tab 并同步活动高亮。 */
  private revealTab(tab: ChatTab): void {
    tab.panel?.reveal()
    // reveal 会触发 onDidChangeViewState；未触发时（已活动/无焦点变化）兜底。
    this.recomputeActive()
  }

  /** 释放一个 tab 的全部资源（panel + controller + 订阅），从 map 移除。 */
  private disposeTab(tab: ChatTab): void {
    tab.controllerSub?.dispose()
    tab.controllerSub = null
    tab.controller?.dispose()
    tab.controller = null
    const panel = tab.panel
    tab.panel = null
    tab.msgSub = null
    tab.viewStateSub = null
    const key = tab.sessionId ?? ChatViewProvider.EMPTY_TAB_KEY
    if (this.tabs.get(key) === tab) this.tabs.delete(key)
    panel?.dispose()
    this.syncAttachedSessions()
  }

  /** 服务 down / 重启：释放所有 controller（panel 保留显示空态，等待恢复）。 */
  private detachAllControllers(): void {
    for (const tab of this.tabs.values()) {
      tab.controllerSub?.dispose()
      tab.controllerSub = null
      tab.controller?.dispose()
      tab.controller = null
      this.push(tab, this.emptyState())
      this.syncPanelTitle(tab)
    }
    this.recomputeActive()
  }

  private onServerState(status: ServerStatus): void {
    if (status.state !== 'running' || !status.url) {
      // Server down → 全部空态；旧 controller 全释放。
      this.detachAllControllers()
      this.lastUrl = null
    } else if (this.lastUrl !== status.url) {
      // 新服务（首次启动或重启，url 变化）：旧 controller 全释放，重启场景
      // 记住最近活动的会话，等 store 基线刷新确认后只恢复它（任务范围：
      // 「可先只恢复活动的」）。
      this.lastUrl = status.url
      const prevActive = this.lastActiveSessionId
      this.detachAllControllers()
      if (prevActive) this.pendingRestoreSessionId = prevActive
    }
    // 面板空态依赖 serverState/dshNotFound，状态变化时同步推一次。
    this.pushSessions()
  }

  private push(tab: ChatTab, state: ChatState): void {
    const message: ToWebviewMessage = { type: 'state', state: this.composeHeader(state, tab) }
    void tab.panel?.webview.postMessage(message)
  }

  /**
   * 把编辑器 tab 标题同步到附着会话的标题（含 dsh 自动命名/用户重命名，均经
   * controller 的 title 投影到达）。会话未命名时以「会话 <ID 前 8 位>」兜底，
   * 无会话空态回落「DSH One」。面板已销毁（panel 为 null）时跳过，不写悬空引用。
   */
  private syncPanelTitle(tab: ChatTab): void {
    if (!tab.panel) return
    const state = tab.controller?.getState()
    tab.panel.title = !state?.sessionId
      ? 'DSH One'
      : state.sessionTitle ?? `会话 ${state.sessionId.slice(0, 8)}`
  }

  /**
   * 头部信息区：附着会话的 continuable 子代理（SessionsStore 的 session.list
   * 基线里 origin === 'subagent' 且 parentSessionId 指向它的行，含已完成的）、
   * 全部后台 job（JobsStore 的 mux 基线，含已结束，按官方 JobListAction 行序）、
   * 空会话 hero 区的 workspace 名（workspace.list 基线，blank 会话也在所属
   * workspace 的 sessionIds 里），以及头部只读 preset 标签——渠道对齐官方
   * AgentPresetLabel：session.list 基线的 agentPreset id（官方
   * sessionSummarySchema 字段，创建时即定、新旧会话都有）经 controller 的
   * roster 映射成显示名，roster 的 description 作为悬停 tooltip
   * （presetDescription，对齐官方 AgentPresetLabel 的悬停描述）。空会话由
   * hero 的选择 chip 呈现当前 preset（
   * state.agentPreset 在），标签不重复。附着的是真子代理会话（origin ===
   * 'subagent'）时另合成面包屑父段 parentSession（「父标题 / 子标题」，点击
   * 回父会话，对齐官方 dsh web 的子代理进入逻辑）。字段为空时都缺省，
   * webview 不渲染。
   */
  private composeHeader(state: ChatState, tab: ChatTab): ChatState {
    if (!state.sessionId) return state
    const raw = this.store.rawList()
    // 血缘树：直接子代理为顶层项，每项的 children 递归挂各自后代
    // （子代理再开子代理）。每层按 运行中优先 + 新近优先 在纯函数里排好；
    // 状态点由 webview 按 running 字段画。行显示名用 subagent.list 目录的
    // descriptor label（label ?? id），落到 labelFor 层面就是「目录有该子代理用
    // label，没有回退 title/短 id」——对齐官方 dsh web 的菜单行名。
    const subagents = buildSubagentTree(raw, state.sessionId, (s) => this.subagents.labelFor(s.sessionId))
    const jobs = orderJobs(this.jobs.jobs().get(state.sessionId) ?? [])
    const workspaceLabel = this.store.workspaceLabelFor(state.sessionId)
    const self = raw.find((s) => s.sessionId === state.sessionId)
    // 面包屑父段：只有附着的是真子代理（origin === 'subagent'）才合成
    // 「父会话标题 /」，webview 点击回到父会话（官方 dsh web 的进入逻辑）。
    // 普通 fork 会话虽有 parentSessionId 但不写 origin，不显示父标题。
    const parentId = self?.origin === 'subagent' ? self?.parentSessionId : undefined
    const parent = parentId ? raw.find((s) => s.sessionId === parentId) : undefined
    const parentSession = parentId
      ? { sessionId: parentId, title: parent?.title ?? `会话 ${parentId.slice(0, 8)}` }
      : undefined
    const presetId = self?.agentPreset
    const presetLabel =
      !state.agentPreset && presetId !== undefined ? tab.controller?.agentPresetLabelFor(presetId) : undefined
    const presetDescription =
      !state.agentPreset && presetId !== undefined
        ? tab.controller?.agentPresetDescriptionFor(presetId)
        : undefined
    return {
      ...state,
      ...(subagents.length > 0 ? { subagents } : {}),
      ...(jobs.length > 0 ? { backgroundJobs: jobs } : {}),
      ...(workspaceLabel ? { workspaceLabel } : {}),
      ...(parentSession ? { parentSession } : {}),
      ...(presetLabel ? { presetLabel } : {}),
      ...(presetDescription ? { presetDescription } : {}),
    }
  }

  /** Store 快照 + 服务状态，合成面板用的 SessionsSnapshot（推给所有打开的 tab）。 */
  private pushSessions(): void {
    const status = this.manager.getStatus()
    const snapshot: SessionsSnapshot = {
      ...this.store.snapshot(),
      serverState: status.state,
      dshNotFound: status.state === 'error' && status.reason === 'dshNotFound',
      activeSessionId: this.activeSessionId,
      attachedSessionId: this.attachedSessionId,
    }
    const message: ToWebviewMessage = { type: 'sessions', snapshot }
    for (const tab of this.tabs.values()) {
      void tab.panel?.webview.postMessage(message)
    }
  }

  private async onMessage(tab: ChatTab, m: FromWebviewMessage): Promise<void> {
    // Webview 重载后（tab 切走再切回时 VSCode 重新加载面板内容）报到：立即重推
    // 当前 ChatState 与 sessions 快照，恢复界面。不能依赖事件驱动推送——重载
    // 后若无新事件，webview 会一直收不到状态。
    if (m?.type === 'ready') {
      this.push(tab, tab.controller?.getState() ?? this.emptyState())
      this.pushSessions()
      return
    }
    // Install guide works with no session (and no server) attached.
    if (m?.type === 'openInstallPage') {
      void vscode.commands.executeCommand('dshOne.openInstallPage')
      return
    }
    // 对话里的外链（webview 已阻止自身导航，见 chat/webview.ts 的锚点拦截）：
    // 用系统默认浏览器打开，与插件其余链接（安装页/状态栏打开 dsh 页）一致。
    if (m?.type === 'openExternal' && typeof m.url === 'string') {
      if (/^(https?|mailto):/i.test(m.url)) {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(m.url))
        } catch (err) {
          this.logger.warn(`chat: openExternal(${m.url}) failed — ${err instanceof Error ? err.message : err}`)
        }
      }
      return
    }
    // 外链右键菜单「内置浏览器打开」：VS Code 自带 Simple Browser（简单浏览器
    // 扩展）；不可用（被禁用/未安装）时兜底系统浏览器，不静默失败。
    if (m?.type === 'openInBuiltinBrowser' && typeof m.url === 'string') {
      if (!/^(https?|mailto):/i.test(m.url)) return
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', m.url)
      } catch (err) {
        this.logger.warn(`chat: simpleBrowser.show(${m.url}) failed — ${err instanceof Error ? err.message : err}`)
        void vscode.env.openExternal(vscode.Uri.parse(m.url))
      }
      return
    }
    // 子代理下拉名称 / 会话 @ 引用 chip 点击：打开（或揭示）该会话的 tab。
    // 不依赖当前 tab 的 controller，故放在 controller 判定之前。
    if (m?.type === 'sessionOpen' && typeof m.sessionId === 'string') {
      this.openSession(m.sessionId)
      return
    }
    // 拆分后会话列表为原生 tree，webview（editor 面板）不再发送 sessions 面板
    // 消息；其余全部落在本 tab 的 controller 上。
    const controller = tab.controller
    if (!controller || !m || typeof m.type !== 'string') return
    try {
      switch (m.type) {
        case 'send': {
          const text = typeof m.text === 'string' ? m.text.trim() : ''
          const images = Array.isArray(m.images) ? m.images : []
          if (!text && images.length === 0) return
          // Slash commands route to runCommand; pasted absolute paths like
          // /Users/… are prompts for the model, not commands.
          if (looksLikeSlashCommand(text)) {
            await this.runCommand(tab, controller, text, images)
            return
          }
          await controller.send(text, images, m.steer === true)
          return
        }
        case 'stop': {
          const restored = await controller.stop()
          if (restored.length > 0) {
            const message: ToWebviewMessage = { type: 'restoreDraft', text: restored.join('\n') }
            void tab.panel?.webview.postMessage(message)
          }
          return
        }
        case 'approval':
          await controller.respondApproval(m.rpcId, m.outcome)
          return
        case 'answer':
          await controller.answerQuestion(m.rpcId, m.answers)
          return
        case 'pickFiles':
          await this.pickFiles(tab, controller)
          return
        case 'filesPasted':
          await this.stagePastedFiles(tab, controller, Array.isArray(m.files) ? m.files : [])
          return
        case 'requestModels':
          await this.sendModelCatalog(tab, controller)
          return
        case 'setModel':
          await this.applyModelSelection(tab, controller, {
            provider: m.provider,
            model: m.model,
            reasoningEffort: m.reasoningEffort,
          })
          return
        case 'setPermission':
          await this.setPermission(tab, controller, m.value)
          return
        case 'setAgentPreset': {
          // 失败（尤其 agent-preset-locked：会话已开跑）只记日志，不打扰用户。
          try {
            await controller.setAgentPreset(m.id)
          } catch (err) {
            this.logger.warn(`chat: setAgentPreset(${m.id}) failed — ${err instanceof Error ? err.message : err}`)
          }
          return
        }
        case 'renameSession':
          await this.renameCurrentSession(controller, m.title)
          return
        case 'fileRefList': {
          // @ 补全候选：失败静默降级为空列表（对齐 web——这个领域失败只是
          // 少出候选，不弹错误打断输入）。
          let items: FileRefCandidate[] = []
          try {
            items = await listFileReferences(controller.url, controller.sessionId, m.query)
          } catch (err) {
            this.logger.warn(`chat: fileRefList(${JSON.stringify(m.query)}) failed — ${err instanceof Error ? err.message : err}`)
          }
          const message: ToWebviewMessage = { type: 'fileRefList', requestId: m.requestId, items }
          void tab.panel?.webview.postMessage(message)
          return
        }
        case 'queueEdit':
          await controller.editQueued(m.itemId, m.text)
          return
        case 'queueSteer':
          await controller.steerQueued(m.itemId)
          return
        case 'queueRemove':
          await controller.removeQueued(m.itemId)
          return
        case 'requestAttachment':
          await this.sendAttachment(tab, controller, m.attachmentId)
          return
        case 'feedback':
          await controller.rateMessage(m.messageId, m.rating)
          return
        case 'fork':
          await this.forkAt(controller, m.atSeq)
          return
        case 'loadEarlier':
          await controller.loadEarlier()
          return
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      this.logger.warn(`chat: ${m.type} failed — ${detail}`)
      vscode.window.showErrorMessage(`聊天操作失败：${detail}`)
    }
  }

  /** Fetch the session's model catalog and push it to the tab's model menu. */
  private async sendModelCatalog(tab: ChatTab, controller: ChatSessionController): Promise<void> {
    try {
      const models = await sessionModels(controller.url, controller.sessionId)
      const message: ToWebviewMessage = {
        type: 'modelCatalog',
        catalog: {
          current: models.current,
          groups: models.groups.map((g) => ({
            id: g.id,
            name: g.name,
            models: g.models.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description,
              efforts: m.reasoning?.efforts ?? [],
              defaultEffort: m.reasoning?.defaultEffort,
            })),
          })),
        },
      }
      void tab.panel?.webview.postMessage(message)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`获取模型列表失败：${detail}`)
    }
  }

  /** Fetch one attachment's bytes and push them to the tab for inline rendering. */
  private async sendAttachment(tab: ChatTab, controller: ChatSessionController, attachmentId: string): Promise<void> {
    if (typeof attachmentId !== 'string' || !attachmentId) return
    try {
      const { mediaType, data } = await sessionAttachment(controller.url, controller.sessionId, attachmentId)
      const message: ToWebviewMessage = { type: 'attachmentData', attachmentId, mediaType, data }
      void tab.panel?.webview.postMessage(message)
    } catch (err) {
      // Thumbnail stays a placeholder; not worth an error popup.
      const detail = err instanceof Error ? err.message : String(err)
      this.logger.warn(`chat: attachment ${attachmentId} fetch failed — ${detail}`)
    }
  }

  private async applyModelSelection(
    tab: ChatTab,
    controller: ChatSessionController,
    selection: SessionModelSelection,
  ): Promise<void> {
    try {
      await selectModel(controller.url, controller.sessionId, selection)
      // 切模型后立即重算 contextBar 的窗口：用新模型窗口覆写 contextPressure，
      // 不等下一条消息（否则会停留在旧模型窗口直到发消息）。
      controller.applyModelSwitch(selection)
      await controller.refreshModels()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`切换模型失败：${detail}`)
    }
  }

  /**
   * Permission preset switch; rides the /permission slash command through the
   * dedicated command channel (session.prompt would not dispatch it). Mirrors
   * the web client: `danger-full-access` requires an explicit risk
   * confirmation first. The resulting permission/preset event refreshes the
   * footer pill through the permissions projection push.
   */
  private async setPermission(tab: ChatTab, controller: ChatSessionController, value: string): Promise<void> {
    if (value === 'danger-full-access') {
      const confirm = await vscode.window.showWarningMessage(
        '确认启用 Full access？启用后 agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
        { modal: true },
        '启用 Full access',
      )
      if (!confirm) return
    }
    await this.runCommand(tab, controller, `/permission ${value}`)
  }

  /**
   * 软移除 workspace（dsh web 同款语义）：modal 确认后调 host 的
   * workspace.delete——只删注册表记录，磁盘文件夹与会话日志保留，
   * 组内会话归入「未分组」。当前 VSCode 窗口打开的 workspace 也允许移除。
   */
  private async removeWorkspace(workspaceId: string, label: string): Promise<void> {
    const url = this.store.runningUrl
    if (!url) return
    const confirm = await vscode.window.showWarningMessage(
      `将把“${label}”从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在“未分组”下。`,
      { modal: true },
      '从列表移除',
    )
    if (!confirm) return
    try {
      await deleteWorkspace(url, workspaceId)
    } catch (error) {
      this.logger.warn(`workspace: remove ${workspaceId} failed: ${errorText(error)}`)
      vscode.window.showWarningMessage(`移除工作区失败：${errorText(error)}`)
      return
    }
    await this.store.refresh()
  }

  /**
   * Execute one slash-command line. Matched commands need no local echo: the
   * host logs command/run before the handler and command/done after it, and
   * those events render as flow nodes in the message stream (same as the
   * official web client). Only an unmatched line — which logs nothing
   * host-side — gets a composer notice here.
   */
  private async runCommand(
    tab: ChatTab,
    controller: ChatSessionController,
    line: string,
    images?: OutgoingImage[],
  ): Promise<void> {
    const outcome = await executeCommand(controller.url, controller.sessionId, line, images)
    if (!outcome.matched) {
      const message: ToWebviewMessage = { type: 'commandResult', text: `未知或格式错误的命令：${line}` }
      void tab.panel?.webview.postMessage(message)
      return
    }
    // `/export` only marks the request host-side ("Session log download
    // requested."); the bytes come from /api/session.export, which the
    // browser client hands to its download manager. Here we save via dialog.
    const name = line.trim().slice(1).split(/\s/, 1)[0]
    if (name === 'export' && outcome.kind === 'success') {
      await this.saveSessionLog(controller)
    }
  }

  /** Fetch the session-log ZIP and let the user pick where to save it. */
  private async saveSessionLog(controller: ChatSessionController): Promise<void> {
    try {
      const zip = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在导出会话日志…' },
        () => exportSessionLog(controller.url, controller.sessionId),
      )
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', sessionLogZipFilename(controller.sessionId))),
        filters: { ZIP: ['zip'] },
        saveLabel: '保存会话日志',
      })
      if (!target) return
      await fs.writeFile(target.fsPath, zip)
      void vscode.window.showInformationMessage(`会话日志已保存到 ${target.fsPath}`)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`导出会话日志失败：${detail}`)
    }
  }

  /** Fork the session at a completed turn, then open the child session in a new tab. */
  private async forkAt(controller: ChatSessionController, atSeq: number): Promise<void> {
    try {
      const childId = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在创建分支会话…' },
        () => controller.fork(atSeq),
      )
      // The tree learns about the child via this hook; the chat opens a new
      // tab for it (用户决策：fork 后新开 tab，原会话 tab 保留便于对照).
      this.onSessionsChanged?.()
      this.openSessionInNewTab(childId)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`创建分支会话失败：${detail}`)
    }
  }

  /** Rename the attached session; the title projection push refreshes the header. */
  private async renameCurrentSession(controller: ChatSessionController, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!trimmed) return
    try {
      await renameSession(controller.url, controller.sessionId, trimmed)
      this.onSessionsChanged?.()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      vscode.window.showErrorMessage(`重命名会话失败：${detail}`)
    }
  }

  /**
   * Attachment picker: images are read into base64 and staged via the shared
   * validator; any other file already lives on disk, so it is staged as a
   * path chip (no temp copy needed).
   */
  private async pickFiles(tab: ChatTab, controller: ChatSessionController): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: '添加附件',
      // No filters: any file type is a valid attachment (images are inlined,
      // everything else goes into the prompt as a path).
    })
    if (!uris || uris.length === 0) return
    const skipped: string[] = []
    const images: OutgoingImage[] = []
    const paths: string[] = []
    for (const uri of uris) {
      const mediaType = IMAGE_MEDIA_TYPES[path.extname(uri.fsPath).toLowerCase()]
      if (!mediaType) {
        paths.push(uri.fsPath)
        continue
      }
      const name = path.basename(uri.fsPath)
      let data: Uint8Array
      try {
        data = await fs.readFile(uri.fsPath)
      } catch (err) {
        skipped.push(`${name}（读取失败：${err instanceof Error ? err.message : String(err)}）`)
        continue
      }
      images.push({ mediaType, data: Buffer.from(data).toString('base64'), name })
    }
    this.stageImages(tab, controller, images, skipped)
    if (paths.length > 0) {
      const message: ToWebviewMessage = {
        type: 'filesPicked',
        files: paths.map((p) => ({ name: path.basename(p), path: p })),
      }
      void tab.panel?.webview.postMessage(message)
    }
  }

  /**
   * Paste intake: every clipboard file becomes an attachment. Images (sniffed
   * from bytes, or a declared image/* type) go through the same staging and
   * limit validation as the picker; anything else is written to a temp file
   * and staged as a path chip for the agent to read.
   */
  private async stagePastedFiles(tab: ChatTab, controller: ChatSessionController, files: OutgoingImage[]): Promise<void> {
    if (files.length === 0) return
    const images: OutgoingImage[] = []
    const staged: Array<{ name: string; path: string }> = []
    const skipped: string[] = []
    for (const file of files) {
      const name = file.name ?? '附件'
      const bytes = Buffer.from(file.data, 'base64')
      const mediaType = sniffImageMediaType(bytes) ?? file.mediaType.trim().toLowerCase()
      if (mediaType.startsWith('image/')) {
        images.push({ ...file, mediaType })
        continue
      }
      try {
        staged.push({ name, path: await this.saveTempAttachment(name, bytes) })
      } catch (err) {
        skipped.push(`${name}（写入临时文件失败：${err instanceof Error ? err.message : String(err)}）`)
      }
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(`已跳过 ${skipped.length} 个文件：${skipped.join('；')}`)
    }
    this.stageImages(tab, controller, images)
    if (staged.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: staged }
      void tab.panel?.webview.postMessage(message)
    }
  }

  /** Persist a non-image paste under the OS temp dir; returns the file path. */
  private async saveTempAttachment(name: string, bytes: Buffer): Promise<string> {
    const dir = path.join(os.tmpdir(), 'dsh-one-attachments')
    await fs.mkdir(dir, { recursive: true })
    const safe = name.replace(/[^\w.-]+/g, '_') || 'attachment'
    const file = path.join(dir, `${Date.now()}-${safe}`)
    await fs.writeFile(file, bytes)
    this.logger.info(`chat: pasted file saved to ${file}`)
    return file
  }

  /**
   * Validate staged images (from the picker, a webview paste, or the context
   * menu) against the session's image limits; returns the accepted ones.
   * Skipped files are appended to `skipped` with human-readable reasons.
   */
  private validateImages(controller: ChatSessionController, images: OutgoingImage[], skipped: string[]): OutgoingImage[] {
    const limits = controller.imageLimits
    const accepted: OutgoingImage[] = []
    let acceptedBytes = 0
    for (const image of images) {
      const name = image.name ?? '图片'
      const byteLength = Buffer.from(image.data, 'base64').byteLength
      const mediaType = image.mediaType.trim().toLowerCase()
      if (limits && !limits.mediaTypes.some((t) => t.trim().toLowerCase() === mediaType)) {
        skipped.push(`${name}（不支持的格式：${image.mediaType || '未知'}；支持 ${limits.mediaTypes.join('、')}）`)
        this.logger.warn(`chat: image rejected — mediaType=${JSON.stringify(image.mediaType)}, allowed=${JSON.stringify(limits.mediaTypes)}`)
        continue
      }
      if (limits) {
        if (accepted.length >= limits.maxImagesPerMessage) {
          skipped.push(`${name}（每条消息最多 ${limits.maxImagesPerMessage} 张图片）`)
          continue
        }
        if (byteLength > limits.maxImageBytes) {
          skipped.push(`${name}（超过单张 ${formatBytes(limits.maxImageBytes)} 限制）`)
          continue
        }
        if (acceptedBytes + byteLength > limits.maxMessageImageBytes) {
          skipped.push(`${name}（超过单条消息图片总大小 ${formatBytes(limits.maxMessageImageBytes)} 限制）`)
          continue
        }
      }
      accepted.push(image)
      acceptedBytes += byteLength
    }
    return accepted
  }

  /** Validate then post accepted images back to the tab's webview (picker/paste path). */
  private stageImages(tab: ChatTab, controller: ChatSessionController, images: OutgoingImage[], skipped: string[] = []): void {
    if (images.length === 0 && skipped.length === 0) return
    const accepted = this.validateImages(controller, images, skipped)
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(`已跳过 ${skipped.length} 个文件：${skipped.join('；')}`)
    }
    if (accepted.length > 0) {
      const message: ToWebviewMessage = { type: 'imagesPicked', images: accepted }
      void tab.panel?.webview.postMessage(message)
    }
  }

  /**
   * 把暂存的附件投给 tab 的 webview composer（等同点「添加附件」）。视图还没
   * 解析或没有附着会话时留在队列，等 tab 打开 / 重新附着时重投；
   * 有面板却没有会话可挂时清空队列（附件无处可去）。
   */
  private flushStaged(tab: ChatTab): void {
    if (!tab.panel) return
    if (!tab.controller) {
      tab.pendingStagedFiles = []
      tab.pendingStagedImages = []
      return
    }
    if (tab.pendingStagedImages.length > 0) {
      const message: ToWebviewMessage = { type: 'imagesPicked', images: tab.pendingStagedImages }
      void tab.panel.webview.postMessage(message)
      tab.pendingStagedImages = []
    }
    if (tab.pendingStagedFiles.length > 0) {
      const message: ToWebviewMessage = { type: 'filesPicked', files: tab.pendingStagedFiles }
      void tab.panel.webview.postMessage(message)
      tab.pendingStagedFiles = []
    }
  }

  /**
   * 右键「发送到当前会话」：把当前文件作为附件暂存到**当前活动 chat tab**
   * 的 composer，与点「添加附件」等价。无活动 tab 时自动打开当前 workspace
   * 最新的会话 tab，一个都没有则新建；图片走图片附件（缩略图 + 限额校验），
   * 其他文件以路径 chip 暂存，发送时拼进 prompt 让 agent 自己读。
   */
  async attachFileToSession(arg: unknown): Promise<void> {
    const target = contextMenuResource(arg)
    const active = vscode.window.activeTextEditor?.document.uri
    const fsPath = target?.fsPath ?? active?.fsPath
    const scheme = target?.scheme ?? active?.scheme
    if (!fsPath) {
      vscode.window.showWarningMessage('没有可发送的文件：请先在编辑器中打开文件，或在资源管理器中右键一个文件。')
      return
    }
    if (scheme !== undefined && scheme !== 'file') {
      vscode.window.showWarningMessage(`只能发送本地文件（当前资源 scheme 是 ${scheme}）。`)
      return
    }
    const status = await this.manager.ensureStarted()
    if (status.state !== 'running' || !status.url) {
      vscode.window.showErrorMessage('DSH 服务未就绪，无法发送文件。')
      return
    }
    // 目标 = 当前活动 chat tab；焦点不在 chat tab（如正在看文件）时回退到
    // 最近活动过的会话 tab；都没有 → 最新会话 tab，没有则新建一个。
    let targetId = this.activeTab()?.sessionId ?? null
    if (!targetId && this.lastActiveSessionId && this.tabs.has(this.lastActiveSessionId)) {
      targetId = this.lastActiveSessionId
    }
    if (!targetId) {
      targetId = this.store.latestCurrentSessionId() ?? (await this.ensureNewSession())
      if (!targetId) return
    }
    // 已开 → 聚焦；用户关过 → 重建 tab；没开过 → 新建。总让 tab 出现。
    this.openSession(targetId)
    const tab = this.tabs.get(targetId)
    const controller = tab?.controller
    if (!tab || !controller) return
    const name = path.basename(fsPath)
    const mediaType = IMAGE_MEDIA_TYPES[path.extname(fsPath).toLowerCase()]
    if (mediaType) {
      let data: Uint8Array
      try {
        data = await fs.readFile(fsPath)
      } catch (err) {
        vscode.window.showErrorMessage(`读取文件失败：${errorText(err)}`)
        return
      }
      const skipped: string[] = []
      const accepted = this.validateImages(controller, [{ mediaType, data: Buffer.from(data).toString('base64'), name }], skipped)
      if (skipped.length > 0) {
        vscode.window.showWarningMessage(`已跳过 ${skipped.length} 个文件：${skipped.join('；')}`)
        return
      }
      tab.pendingStagedImages.push(...accepted)
    } else {
      tab.pendingStagedFiles.push({ name, path: fsPath })
    }
    // 右键「发送到当前会话」：tab 已开则聚焦（reveal），未开刚建。
    this.revealTab(tab)
    this.flushStaged(tab)
  }

  /**
   * 在默认 workspace 下新建会话（右键发送时没有可附着会话的兜底）。
   * 失败或没有可用 workspace 时返回 null 并已提示用户。
   */
  private async ensureNewSession(): Promise<string | null> {
    const url = this.store.runningUrl
    if (!url) return null
    const targetWorkspaceId = this.store.defaultWorkspaceId()
    if (!targetWorkspaceId) {
      vscode.window.showWarningMessage('没有可用的 workspace，请先在 VSCode 中打开文件夹。')
      return null
    }
    try {
      const sessionId = await createSession(url, targetWorkspaceId)
      await this.store.refresh()
      return sessionId
    } catch (err) {
      vscode.window.showErrorMessage(`新建会话失败：${errorText(err)}`)
      return null
    }
  }

  dispose(): void {
    this.managerSub.dispose()
    this.storeSub.dispose()
    this.jobsSub.dispose()
    this.jobs.dispose()
    this.subagentsSub.dispose()
    this.subagents.dispose()
    for (const tab of [...this.tabs.values()]) {
      tab.controllerSub?.dispose()
      tab.controller?.dispose()
      tab.panel?.dispose()
    }
    this.tabs.clear()
    this.activeEmitter.dispose()
  }
}
