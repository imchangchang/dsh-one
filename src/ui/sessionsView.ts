import { loadWebviewL10n } from './chatViewHtml.ts'
import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import type { Logger } from '../log.ts'
import type { ServerManager, ServerStatus } from '../server/manager.ts'
import { deleteWorkspace, renameSession } from '../server/dshRpc.ts'
import type { FromWebviewMessage, SessionsSnapshot } from '../pure/chatContract.ts'
import { hostOsFromPlatform } from '../pure/installScript.ts'
import type { SessionsStore } from './sessionsStore.ts'

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
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

const SESSIONS_STYLE = `
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: column; height: 100%; }
  .sessions-panel {
    flex: 1; min-height: 0; display: flex; flex-direction: column;
    background: var(--vscode-sideBar-background, transparent);
    position: relative; /* 回收站抽屉的定位基准 */
  }
  .sessions-header {
    flex: none; display: flex; align-items: center; gap: 2px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  /* 搜索框外裹一个相对定位容器，✕ 清空按钮绝对定位其右侧。 */
  .search-wrap {
    flex: 1; min-width: 0; position: relative;
    display: flex; align-items: center;
  }
  .sessions-search {
    flex: 1; min-width: 0; padding: 3px 22px 3px 6px; font-family: inherit; font-size: 12px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
  }
  .sessions-search:focus { outline: 1px solid var(--vscode-focusBorder); }
  /* 一键清除 ✕：默认隐藏，输入非空时显示；半透明 hover 变实，风格同 .sessions-tool。 */
  .search-clear {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    width: 20px; height: 20px; padding: 0;
    display: none; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 3px;
    color: var(--vscode-descriptionForeground, #888); opacity: 0.7; cursor: pointer;
  }
  .search-wrap.has-text .search-clear { display: inline-flex; }
  .search-clear:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .search-clear svg { display: block; }
  .sessions-tool {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 24px; padding: 0; background: transparent; border: 0;
    color: inherit; opacity: 0.7; cursor: pointer; border-radius: 4px;
  }
  .sessions-tool:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .sessions-tool svg { display: block; }
  /* 刷新中：图标短暂旋转 + 按钮变灰，给出操作反馈。 */
  .sessions-tool.refreshing svg { animation: dsh-tool-spin 0.6s linear infinite; }
  @keyframes dsh-tool-spin { to { transform: rotate(360deg); } }
  .sessions-tool:disabled { opacity: 0.5; cursor: default; }
  .sessions-list { flex: 1; overflow-y: auto; padding: 2px 0; }
  /* 多选归档模式的顶部操作条：搜索框下、第一个工作区上。按钮不换行——300px
     侧栏一行放三个按钮靠短文案（同 .recycle-header 的 nowrap 处理）。 */
  .selection-bar {
    flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .selection-bar button { padding: 3px 10px; font-size: 12px; white-space: nowrap; }
  /* 工作区分组栏：搜索框下、列表上一行；左 = 分组选择器（组名 + ▼），右 = 新建分组。 */
  .ws-group-bar {
    flex: none; display: flex; align-items: center; gap: 2px; padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .ws-group-select {
    flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 6px; margin: 0; border: 0; border-radius: 4px;
    background: transparent; color: var(--vscode-foreground);
    font: inherit; font-size: 12px; text-align: left; cursor: pointer;
  }
  .ws-group-select:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .ws-group-select-label {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-weight: 600;
  }
  .ws-group-select-chevron { flex: none; display: inline-flex; color: var(--vscode-descriptionForeground, #888); }
  .ws-group-select-chevron svg { display: block; }
  .ws-group-add {
    flex: none; width: 24px; height: 24px; padding: 0; margin: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 4px;
    color: inherit; opacity: 0.7; cursor: pointer;
  }
  .ws-group-add svg { display: block; }
  .ws-group-add:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  /* 分组菜单分隔线（下拉里「管理分组…」之上）。 */
  .menu-sep { border-top: 1px solid var(--vscode-menu-border, rgba(127,127,127,.2)); margin: 4px 2px; }
  /* 复选框（会话行/组头共用）：自绘外观，indeterminate 画横线。 */
  .select-checkbox {
    flex: none; width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
  }
  .select-checkbox input {
    appearance: none; -webkit-appearance: none; margin: 0; padding: 0;
    width: 14px; height: 14px; box-sizing: border-box; display: block; position: relative;
    border: 1px solid var(--vscode-checkbox-border, rgba(127,127,127,.6));
    border-radius: 4px; background: var(--vscode-checkbox-background, transparent);
    cursor: pointer;
  }
  .select-checkbox input:hover:not(:disabled) { border-color: var(--vscode-focusBorder, #5686fe); }
  .select-checkbox input:checked,
  .select-checkbox input:indeterminate {
    background: var(--vscode-charts-blue, #5686fe); border-color: var(--vscode-charts-blue, #5686fe);
  }
  .select-checkbox input:checked::after {
    content: ''; position: absolute; left: 4px; top: 1px; width: 4px; height: 8px;
    border: solid #fff; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg);
  }
  .select-checkbox input:indeterminate::after {
    content: ''; position: absolute; left: 3px; top: 6px; width: 6px; height: 1.5px; background: #fff;
  }
  .select-checkbox input:disabled { opacity: .35; cursor: default; }
  /* 批量归档确认弹窗：面板内 modal（vscode.window 弹窗放不了树形富内容）。 */
  .selection-modal-overlay {
    position: fixed; inset: 0; z-index: 30;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.35);
  }
  .selection-modal {
    width: min(440px, 92vw); max-height: 70vh; display: flex; flex-direction: column;
    background: var(--vscode-editor-background, var(--vscode-menu-background));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0,0,0,.2);
  }
  .selection-modal-title { padding: 12px 14px 4px; font-size: 13px; font-weight: 600; }
  .selection-modal-desc { padding: 0 14px; font-size: 11px; opacity: .7; }
  /* 树形分组列表：flex:1 + min-height:0 + overflow 自适应，展开也不超屏。 */
  .selection-modal-tree {
    flex: 1; min-height: 0; overflow-y: auto; margin: 8px 8px 0; padding: 4px;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.2));
  }
  .modal-group { margin-bottom: 2px; }
  .modal-group-head {
    display: flex; align-items: center; gap: 6px; padding: 5px 6px;
    border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;
  }
  .modal-group-head:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  .modal-group-arrow { flex: none; width: 10px; height: 10px; color: var(--vscode-descriptionForeground, #888); transition: transform .12s ease; }
  .modal-group:not(.collapsed) .modal-group-arrow { transform: rotate(90deg); }
  .modal-group-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .modal-group-count { flex: none; font-size: 11px; font-weight: 400; opacity: .65; }
  .modal-group.collapsed .modal-group-list { display: none; }
  .modal-session { display: flex; align-items: baseline; gap: 8px; padding: 2px 6px 2px 26px; font-size: 12px; }
  .modal-session-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .modal-session-time { flex: none; font-size: 11px; opacity: .55; }
  .selection-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px 12px; }
  .selection-modal-actions button { padding: 4px 12px; font-size: 12px; }
  /* 分组管理视图弹层（侧栏内 modal）：分组区（建组/改名/删除/拖拽排序）+
     工作区打标区（勾选/取消归组），两区上下排列。 */
  .wsg-manage-overlay {
    position: fixed; inset: 0; z-index: 30;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,.35);
  }
  .wsg-manage {
    width: min(380px, 94vw); max-height: 76vh; display: flex; flex-direction: column;
    background: var(--vscode-editor-background, var(--vscode-menu-background));
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0,0,0,.2);
  }
  .wsg-manage-head {
    flex: none; display: flex; align-items: center; gap: 6px; padding: 10px 10px 6px;
  }
  .wsg-manage-title { flex: 1; min-width: 0; font-size: 13px; font-weight: 600; }
  .wsg-manage-close {
    flex: none; width: 22px; height: 22px; padding: 0; margin: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 4px;
    color: var(--vscode-descriptionForeground, #888); cursor: pointer;
  }
  .wsg-manage-close:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); color: var(--vscode-foreground); }
  .wsg-manage-close svg { display: block; }
  .wsg-manage-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 10px 10px; }
  .wsg-section-title {
    font-size: 11px; opacity: .6; padding: 6px 2px 4px;
  }
  .wsg-groups-empty { padding: 4px 2px 8px; font-size: 12px; opacity: .7; }
  .wsg-row {
    display: flex; align-items: center; gap: 4px; padding: 2px 2px 2px 0;
    border-radius: 6px; cursor: pointer;
  }
  .wsg-row:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  .wsg-row.selected { background: var(--vscode-menu-selectionBackground, rgba(0,122,204,.35)); }
  .wsg-row.dragging { opacity: .55; }
  .wsg-row-handle {
    flex: none; width: 16px; height: 24px; box-sizing: border-box;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
    cursor: grab; touch-action: none;
  }
  .wsg-row-handle:active { cursor: grabbing; }
  .wsg-row-name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px;
  }
  .wsg-row-rename-input {
    flex: 1; min-width: 0; font: inherit; font-size: 12px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; padding: 2px 6px; outline: none;
  }
  .wsg-row-count {
    flex: none; font-size: 10px; font-weight: 400; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .wsg-row-btn {
    flex: none; width: 20px; height: 20px; padding: 0; margin: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: 0; border-radius: 3px;
    color: var(--vscode-descriptionForeground, #888);
    opacity: .8; cursor: pointer;
  }
  .wsg-row-btn:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); color: var(--vscode-foreground); }
  .wsg-row-btn svg { display: block; }
  .wsg-row-confirm { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wsg-row-delete { flex: none; padding: 2px 8px; font-size: 12px; }
  .wsg-error { flex: none; font-size: 11px; color: var(--vscode-errorForeground, #f48771); padding: 2px 4px 0; }
  .wsg-new-row { display: flex; align-items: center; gap: 6px; padding: 6px 2px 2px; }
  .wsg-new-input {
    flex: 1; min-width: 0; font: inherit; font-size: 12px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 3px 6px; outline: none;
  }
  .wsg-new-input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .wsg-new-add { flex: none; padding: 3px 10px; font-size: 12px; white-space: nowrap; }
  /* 「+」快速建组的弹层内容：标题 + 输入 + 错误 + 创建按钮。 */
  .wsg-create { display: flex; flex-direction: column; gap: 6px; padding: 2px; }
  .wsg-create-title { font-size: 12px; font-weight: 600; padding: 2px 4px 0; }
  .wsg-create-input {
    min-width: 160px; font: inherit; font-size: 12px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px;
    padding: 3px 6px; outline: none;
  }
  .wsg-create-input:focus { outline: 1px solid var(--vscode-focusBorder); }
  .wsg-create-submit { align-self: flex-end; padding: 3px 10px; font-size: 12px; }
  /* 工作区打标区：选中某组后列出全部 workspace，勾选 = 归组。 */
  .wsg-members { border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.2)); margin-top: 8px; padding-top: 2px; }
  .wsg-members-title {
    display: flex; align-items: center; gap: 6px; padding: 6px 2px;
    font-size: 12px; font-weight: 600;
  }
  .wsg-members-title-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wsg-hint { padding: 2px; font-size: 12px; opacity: .7; }
  .wsg-member {
    display: flex; align-items: center; gap: 6px; padding: 4px 2px;
    font-size: 12px; cursor: pointer;
  }
  .wsg-member input { flex: none; margin: 0; accent-color: var(--vscode-charts-blue, #5686fe); cursor: pointer; }
  .wsg-member-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 回收站抽屉：从面板底部滑出，默认占据约一半高度，叠加在主列表上（主列表
     上半部仍可见可交互，不整栏切换）；提手上拉可扩到 90%（.expanded），
     下拉到底松手 = 收起。无遮罩直接叠——点击抽屉外区域即收起。 */
  .recycle-drawer {
    position: absolute; left: 0; right: 0; bottom: 0; height: 50%;
    z-index: 10;
    display: flex; flex-direction: column;
    background: var(--vscode-editor-background, var(--vscode-sideBar-background, transparent));
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    box-shadow: 0 -10px 24px rgba(0,0,0,.16);
    transform: translateY(100%);
    transition: transform .2s ease;
  }
  .recycle-drawer.open { transform: translateY(0); }
  .recycle-drawer.expanded { height: 90%; }
  /* 提手条：全宽可拖区 + 顶部居中小横条（上拉扩大 / 下拉收起的入口）。 */
  .recycle-drawer-handle {
    flex: none; display: flex; align-items: center; justify-content: center;
    height: 16px; cursor: grab; touch-action: none;
  }
  .recycle-drawer-handle:active { cursor: grabbing; }
  .recycle-drawer-grip {
    width: 36px; height: 4px; border-radius: 2px;
    background: var(--vscode-descriptionForeground, #888); opacity: 0.5;
  }
  .recycle-list { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 0; }
  /* 回收站入口行（面板底部固定，不随列表滚动）：描边垃圾桶 + 标签 + 计数；
     计数为 0 时灰态。压掉全局 button 的实底样式。 */
  .recycle-entry {
    flex: none; width: 100%; box-sizing: border-box;
    display: flex; align-items: center; gap: 6px;
    padding: 7px 14px; margin: 0; border: 0; border-radius: 0;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    background: transparent; color: var(--vscode-foreground);
    font: inherit; font-size: 12px; text-align: left; cursor: pointer;
  }
  .recycle-entry:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  .recycle-entry.is-empty { color: var(--vscode-descriptionForeground, #888); opacity: .75; }
  .recycle-entry svg { flex: none; }
  .recycle-entry-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recycle-entry-count {
    flex: none; font-size: 10px; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .recycle-entry.is-empty .recycle-entry-count { background: transparent; padding: 0; opacity: .8; }
  /* 回收站视图头：‹ 返回 + 标题 + 清空回收站，右侧「恢复全部」。 */
  .recycle-header {
    flex: none; display: flex; align-items: center; gap: 6px; padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
  }
  .recycle-back {
    flex: none; display: inline-flex; align-items: center; gap: 2px;
    padding: 3px 6px; margin: 0; border: 0; border-radius: 4px;
    background: transparent; color: var(--vscode-foreground);
    font: inherit; font-size: 12px; cursor: pointer;
  }
  .recycle-back:hover { background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .recycle-header-title {
    flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .recycle-header-title > span:first-child {
    flex: 0 1 auto; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  /* 计数徽标（紧跟标题文本，同一内联组）：flex:none 不被标题省略号截掉——
     计数是视图头/入口的关键信息（窄侧栏标题被按钮挤掉时徽标恒显示）。 */
  .recycle-header-count {
    flex: none; font-size: 10px; font-weight: 400; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .recycle-header-spacer { flex: 1; }
  /* 回收站视图头按钮小号化（压全局 button 默认尺寸）；不换行。 */
  .recycle-header button { padding: 3px 10px; font-size: 12px; white-space: nowrap; }
  /* 清空回收站用图标按钮（300px 侧栏一行放不下三个文本按钮 + 标题）：
     34×34 点击区 + 22px 图标，与「恢复全部」文本按钮相称（用户实测反馈
     20px 太小、放大后仍偏小）；padding 归零 + border-box 保证按钮尺寸精确；
     悬停提示/aria 都带全名「Empty recycle bin」。 */
  .recycle-header .sessions-tool { width: 34px; height: 34px; padding: 0; box-sizing: border-box; }
  .workspace-row {
    display: flex; align-items: center; gap: 6px; padding: 0 10px;
    height: 32px; box-sizing: border-box; overflow: hidden;
    font-weight: 600; font-size: 12px; cursor: pointer;
  }
  .workspace-row:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  /* 行首图标槽：默认文件夹图标，hover 换成实心三角（dsh web 分组行模式）。 */
  .ws-folder, .ws-arrow {
    flex: none; width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--vscode-descriptionForeground, #888);
  }
  .ws-arrow { display: none; }
  .workspace-row:hover .ws-arrow { display: inline-flex; }
  .workspace-row:hover .ws-folder { display: none; }
  /* 空组无可展开内容：hover 不切换成三角，保持闭合文件夹图标。 */
  .workspace-row.empty:hover .ws-arrow { display: none; }
  .workspace-row.empty:hover .ws-folder { display: inline-flex; }
  /* 附着会话所在 workspace 的文件夹图标染 deepseek 蓝（dsh web 同款标识）。 */
  .workspace-row.has-active .ws-folder { color: var(--vscode-charts-blue, #5686fe); }
  .ws-arrow svg { transition: transform .15s ease; }
  .workspace-row.expanded .ws-arrow svg { transform: rotate(90deg); }
  /* label + counts 包在组里：组占 flex:1（badge 仍右对齐），组内 counts 紧跟
     label 文本（label 只收缩不伸展，省略号行为不变）。 */
  .workspace-label-group {
    flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px;
  }
  .workspace-label { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 组名右侧角标：待交互/运行中/未读 计数（小字 + 小图标，紧凑、不挤压 label/badge）。 */
  .ws-counts { flex: none; display: inline-flex; align-items: center; gap: 6px; }
  .ws-count { display: inline-flex; align-items: center; gap: 2px; font-size: 10px; line-height: 1; opacity: 0.75; }
  .workspace-badge {
    flex: none; font-size: 10px; font-weight: 400; padding: 0 5px; border-radius: 8px;
    background: var(--vscode-badge-background, rgba(127,127,127,.25));
    color: var(--vscode-badge-foreground, var(--vscode-foreground));
  }
  .session-row {
    display: flex; align-items: center; gap: 6px; margin: 0 4px; padding: 0 6px 0 12px;
    height: 32px; box-sizing: border-box; overflow: hidden;
    cursor: pointer; border-radius: 4px; font-size: 12px;
  }
  .session-row:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  /* 会话菜单打开期间保持来源行的 hover 背景（webview.ts 的 .menu-open）。 */
  .session-row.menu-open { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  .session-row.active {
    background: var(--vscode-list-activeSelectionBackground, rgba(0,122,204,.35));
    color: var(--vscode-list-activeSelectionForeground, inherit);
  }
  /* 行首状态槽：宽度固定（对齐官方 dsh web 的 16px slot），四种标记同一位置
     居中——待交互黄点 > 运行中像素环 > 已完成/未读绿点 > 置顶图钉；空闲会话留空。 */
  .session-status {
    width: 16px; height: 16px; flex: none;
    display: inline-flex; align-items: center; justify-content: center;
  }
  /* 槽内图钉（strokeSvg 固定输出 14px，缩到 13px 与槽匹配）。 */
  .session-status svg.pin-icon { width: 13px; height: 13px; display: block; color: var(--vscode-descriptionForeground); }
  /* 运行中：官方 dsh web StateDot(ongoing) 的 8 格像素环追逐动画，deepseek 蓝。 */
  .session-spin { display: block; color: var(--vscode-charts-blue, #5686fe); }
  .session-spin rect { fill: currentColor; opacity: 0.15; animation: session-spin-chase 1s infinite; }
  @keyframes session-spin-chase {
    0%, 12.4% { opacity: 1; }
    12.5%, 24.9% { opacity: 0.6; }
    25%, 37.4% { opacity: 0.35; }
    37.5%, to { opacity: 0.15; }
  }
  /* 已完成/未读提醒：绿色实心点 + 标题加粗（对齐官方 StateDot completed
     「已完成」视觉；本地未读沿用同一槽位，仅换颜色，合并逻辑不变）。 */
  .session-dot {
    width: 6px; height: 6px; border-radius: 50%;
  }
  .session-dot.completed { background: var(--vscode-charts-green, #89d185); }
  /* 待审批/待回答/计划待审：黄色实心点（官方 StateDot warning，
     --dsw-alias-state-warn-primary 的 VS Code 对应色）。 */
  .session-dot.warning { background: var(--vscode-charts-yellow, #e5c07b); }
  .session-title.unread { font-weight: 600; }
  /* 组合状态（置顶 + 运行中/未读）时被挤出槽位的图钉，退到标题前。
     main 的 flex gap 已有 8px，用 -2px margin 收回到与行 gap 一致的 6px。 */
  .session-pin {
    flex: none; width: 14px; height: 14px; margin-right: -2px;
    color: var(--vscode-descriptionForeground);
    display: inline-flex; align-items: center; align-self: center;
  }
  .session-pin svg { width: 14px; height: 14px; display: block; }
  /* 紧凑单行：标题省略号 + 右对齐的相对时间（对齐原原生树的观感）。 */
  .session-main { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px; }
  .session-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 行内重命名输入框：对齐 chat 内改名（session/main 内的 rename-input）。 */
  .session-main .rename-input {
    flex: 1; min-width: 0; font: inherit; font-weight: 500;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-focusBorder, var(--vscode-input-border, transparent));
    border-radius: 4px; padding: 1px 6px; outline: none;
  }
  .session-time { flex: none; font-size: 11px; opacity: 0.55; }
  .row-actions { display: none; gap: 2px; flex: none; }
  .session-row:hover .row-actions, .workspace-row:hover .row-actions { display: inline-flex; }
  /* 菜单打开期间 ⋯ 按钮不随 hover 离开而消失。 */
  .session-row.menu-open .row-actions { display: inline-flex; }
  .row-action {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; padding: 0; background: transparent; border: 0;
    color: inherit; opacity: 0.7; cursor: pointer; border-radius: 3px;
  }
  .row-action:hover { opacity: 1; background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25)); }
  .row-action svg { display: block; }
  .sessions-empty {
    padding: 20px 12px; display: flex; flex-direction: column; align-items: center;
    gap: 6px; text-align: center;
  }
  .sessions-empty .empty-hint { font-size: 12px; }
  .sessions-empty .empty-hint-secondary { font-size: 11px; opacity: 0.55; }
  .sessions-empty button { margin-top: 4px; }
  /* 非官方一键安装脚本块（dshNotFound 空态）：说明 + 平台下拉 + 单行省略命令条 + 复制。 */
  .install-script {
    margin-top: 10px; width: 100%; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 6px; align-items: stretch;
  }
  .install-script-hint { font-size: 12px; opacity: 0.7; }
  /* kimi 式一排：平台按钮 + 命令条同排 flex-wrap——容器够宽左右排，侧栏窄时
     命令条换到下一行上下排（min-width 260px 触发换行）。 */
  .install-script-row {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: stretch;
  }
  .install-script-platform {
    flex: 0 0 auto;
    display: inline-flex; align-items: center; gap: 5px;
    padding: 3px 10px; border-radius: 12px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; font-size: 11px; font-weight: 500;
  }
  .install-script-platform svg { flex: none; opacity: .8; }
  .install-script-cmd {
    flex: 1 1 260px; min-width: 0;
    display: flex; align-items: center; gap: 4px;
    background: var(--vscode-editorWidget-background, rgba(127,127,127,.12));
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,.3));
    border-radius: 12px; padding: 2px 4px 2px 10px;
  }
  .install-script-code {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px; line-height: 16px; color: var(--vscode-foreground);
  }
  .install-script-copy {
    flex: none; width: 22px; height: 22px; padding: 0; margin: 0;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; color: var(--vscode-descriptionForeground, #888);
    border-radius: 6px;
  }
  .install-script-copy:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(127,127,127,.25));
    color: var(--vscode-foreground);
  }
  .install-script-copy span { font-size: 11px; }
  /* 平台下拉菜单（挂在全局 .popover 容器里）：当前平台加粗 + 对勾。 */
  .install-script-menu-item {
    display: flex; align-items: center; gap: 6px; min-height: 28px; box-sizing: border-box;
    padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap;
  }
  .install-script-menu-item:hover { background: var(--vscode-menu-selectionBackground, rgba(127,127,127,.2)); }
  .install-script-menu-item.active::before { content: '✓'; font-weight: 600; }
  .install-script-menu-item.active { font-weight: 600; }
  /* 内容命中的片段块：跟会话行下面，暗色小字最多 2 行，点击与父行一致。 */
  .session-snippet {
    margin: 0 4px 0 12px; padding: 1px 6px 2px; font-size: 11px; line-height: 16px;
    color: var(--vscode-descriptionForeground, #888);
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    word-break: break-word; cursor: pointer; border-radius: 4px;
  }
  .session-snippet:hover { background: var(--vscode-list-hoverBackground, rgba(127,127,127,.12)); }
  /* 命中关键词高亮：加粗 + 变色（无底色，用户要求"加底色不好看"）。对内容片段、
     会话行标题、workspace 组名三处统一生效。 */
  .session-snippet .dsh-mark,
  .session-title .dsh-mark,
  .workspace-label .dsh-mark {
    font-weight: 600; color: var(--vscode-charts-blue, #5686fe); background: none;
  }
  /* 内容搜索结果超过 20 条的底部轻提示（非交互）。 */
  .sessions-search-more { padding: 6px 12px; font-size: 11px; opacity: 0.6; }
  button {
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: 0; border-radius: 4px; padding: 4px 12px; cursor: pointer;
  }
  button.secondary {
    background: var(--vscode-button-secondaryBackground, rgba(127,127,127,.3));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .popover {
    position: fixed; z-index: 20; min-width: 180px; max-width: 340px; max-height: 50vh; overflow-y: auto;
    /* 兜底实色背景：VS Code 恒注入 menu-background；harness 等无主题变量的环境
       下透明会叠出下层列表。 */
    background: var(--vscode-menu-background, var(--vscode-dropdown-background, #ffffff));
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
  /* 禁用态菜单项：置灰、cursor 默认、hover 无高亮（onClick 未绑定）。 */
  .menu-item.disabled,
  .menu-item.disabled:hover {
    opacity: .45; cursor: default; background: none; color: inherit;
  }
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
  .menu-group { padding: 5px 6px 2px; font-size: .8em; opacity: .55; }
  .menu-hint { padding: 8px; opacity: .7; }
  /* 菜单首行的会话标题（操作对象显式化）：置灰小字、单行省略，与菜单项分隔。 */
  .session-menu-title {
    padding: 6px 10px 8px; font-size: .8em; opacity: .55;
    max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    border-bottom: 1px solid var(--vscode-menu-border, rgba(127,127,127,.2));
    margin-bottom: 2px;
  }
  /* 自实现悬停提示：fixed 定位挂在 body 上，不随 .sessions-list 滚动裁剪。
     pre-wrap 让含换行的 data-tip（如降级详情）多行展示，长词可折行。 */
  .dsh-tooltip {
    position: fixed; z-index: 40; pointer-events: none;
    padding: 3px 8px; border-radius: 6px; font-size: 11px; line-height: 16px;
    white-space: pre-wrap; word-break: break-word; max-width: 380px;
    background: var(--vscode-menu-background, var(--vscode-dropdown-background));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--vscode-dropdown-border));
    box-shadow: 0 2px 8px rgba(0,0,0,.2);
  }
`

function sessionsHtml(webview: vscode.Webview, extensionUri: vscode.Uri, l10nJson: string | null): string {
  const n = nonce()
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'sessionsWebview.js'))
  // Same CSP discipline as the chat webview: nonce-gated scripts, no remote resources.
  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'nonce-${n}'`,
  ].join('; ')
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${SESSIONS_STYLE}</style>
</head>
<body>
<div id="app"></div>
${
  l10nJson === null
    ? ''
    : `<script nonce="${n}">window.__DSH_L10N__=${l10nJson.replace(/</g, '\\u003c')};</script>`
}
<script nonce="${n}" src="${escapeHtml(scriptUri.toString())}"></script>
</body>
</html>`
}

/**
 * Sidebar sessions view (`dshOne.chat`): a WebviewViewProvider that renders
 * the sessions list only (no chat). Split in from the original combined
 * webview. Owns the SessionsStore snapshot push（含 activeSessionId，供高亮），
 * routes sessions-panel actions back. Session/workspace actions that touch the
 * editor panel or do RPC are forwarded to extension.ts commands (which open
 * the editor chat panel); pure store ops (search/sort/pin/unread/collapse/
 * refresh) fall directly on the store.
 */
export class SessionsViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | null = null
  private readonly managerSub: vscode.Disposable
  private readonly storeSub: vscode.Disposable
  private readonly activeSub: vscode.Disposable

  constructor(
    private readonly manager: ServerManager,
    private readonly logger: Logger,
    private readonly extensionUri: vscode.Uri,
    private readonly store: SessionsStore,
    /** 高亮会话 id（当前活动 chat tab 的会话，无活动 tab 为 null），来自 editor tabs。 */
    private readonly getActiveSessionId: () => string | null,
    /** 当前活动 chat tab 真实附着的会话 id（活动 tab 未开为 null），行内重命名判定用。 */
    private readonly getAttachedSessionId: () => string | null,
    activeChanged: vscode.Event<string | null>,
  ) {
    this.managerSub = manager.onDidChangeState(() => this.pushSessions())
    this.storeSub = store.onDidChange(() => this.pushSessions())
    this.activeSub = activeChanged(() => this.pushSessions())
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    }
    view.webview.html = sessionsHtml(view.webview, this.extensionUri, loadWebviewL10n(this.extensionUri))
    const msg = view.webview.onDidReceiveMessage((m: FromWebviewMessage) => void this.onMessage(m))
    // 侧栏从不可见回到可见（展开/折叠、切到别的 view group）：列表可能已过期。
    const visibilitySub = view.onDidChangeVisibility(() => {
      if (view.visible) void this.store.refreshSoon()
    })
    view.onDidDispose(() => {
      msg.dispose()
      visibilitySub.dispose()
      if (this.view === view) this.view = null
    })
    this.pushSessions()
    // 视图首次变得可见、或被隐藏后重新显示（webview 重建）时刷新基线；pushSessions 保留。
    void this.store.refreshSoon()
  }

  /** Store 快照 + 服务状态 + 当前高亮会话，合成面板用的 SessionsSnapshot。 */
  private pushSessions(): void {
    if (!this.view) return
    const status = this.manager.getStatus()
    const snapshot: SessionsSnapshot = {
      ...this.store.snapshot(),
      serverState: status.state,
      dshNotFound: status.state === 'error' && status.reason === 'dshNotFound',
      hostOs: hostOsFromPlatform(process.platform),
      activeSessionId: this.getActiveSessionId(),
      attachedSessionId: this.getAttachedSessionId(),
    }
    const message: { type: 'sessions'; snapshot: SessionsSnapshot } = { type: 'sessions', snapshot }
    void this.view.webview.postMessage(message)
  }

  private async onMessage(m: FromWebviewMessage): Promise<void> {
    if (!m || typeof m.type !== 'string') return
    switch (m.type) {
      // 打开/更新 editor 面板并附着（复用 extension 命令，其内部 openSession：
      // 默认在当前活动 chat tab 打开）。
      case 'sessionOpen':
        void vscode.commands.executeCommand('dshOne.session.open', m.sessionId)
        return
      // 右键菜单「在新 tab 中打开」：显式新开一个会话 tab。
      case 'sessionOpenInNewTab':
        void vscode.commands.executeCommand('dshOne.session.openInNewTab', m.sessionId)
        return
      case 'sessionNew':
        void vscode.commands.executeCommand('dshOne.session.new', m.workspaceId)
        return
      case 'sessionNewUngrouped':
        void vscode.commands.executeCommand('dshOne.session.newUngrouped')
        return
      case 'sessionRename':
        void vscode.commands.executeCommand('dshOne.session.rename', m.sessionId, m.title)
        return
      case 'sessionRenameDirect':
        void this.renameSessionDirect(m.sessionId, m.title)
        return
      case 'sessionArchive':
        void vscode.commands.executeCommand('dshOne.session.archive', m.sessionId, m.title)
        return
      // 批量归档（多选模式）：确认框在 webview 内，宿主直接执行并把失败 id
      // 回传（archiveManyDone）；面板收悉即退出多选（失败项此处已弹提示）。
      case 'sessionArchiveMany': {
        void (async () => {
          const ids = Array.isArray(m.sessionIds) ? m.sessionIds.filter((x): x is string => typeof x === 'string') : []
          if (ids.length === 0) return
          let failed: string[] = ids
          try {
            const result = await vscode.commands.executeCommand<unknown>('dshOne.session.archiveMany', ids)
            failed = Array.isArray(result) ? result.filter((x): x is string => typeof x === 'string') : []
          } catch {
            // 命令整体失败（如基线刷新抛错）：全部保留勾选，让用户重试。
          }
          this.view?.webview.postMessage({ type: 'archiveManyDone', failed })
        })()
        return
      }
      case 'sessionFork':
        void vscode.commands.executeCommand('dshOne.session.fork', m.sessionId)
        return
      // 移入回收站（可逆本地操作，不碰 dsh）：置顶会话与归档同规则拒绝——
      // 回收站清空 = 归档，置顶入站会绕过置顶保护（UI 已置灰，这里兜底）。
      case 'sessionMoveToRecycle':
        if (this.store.snapshot().pinned.includes(m.sessionId)) {
          vscode.window.showWarningMessage(
            vscode.l10n.t('Pinned sessions cannot be moved to the recycle bin; unpin them first'),
          )
          return
        }
        this.store.moveToRecycleBin(m.sessionId)
        return
      // 批量移入（多选操作条）：置顶 id 跳过并提示（正常流程下勾选已排除置顶，
      // 命中表示绕过 UI 的竞态/异常路径）。
      case 'sessionMoveToRecycleMany': {
        const ids = Array.isArray(m.sessionIds)
          ? m.sessionIds.filter((x): x is string => typeof x === 'string' && x !== '')
          : []
        if (ids.length === 0) return
        const pinned = new Set(this.store.snapshot().pinned)
        const accepted = ids.filter((id) => !pinned.has(id))
        const rejected = ids.length - accepted.length
        if (accepted.length > 0) this.store.moveToRecycleBinMany(accepted)
        if (rejected > 0) {
          vscode.window.showWarningMessage(
            vscode.l10n.t('{0} pinned session(s) cannot be moved to the recycle bin; unpin them first', rejected),
          )
        }
        return
      }
      case 'sessionRestore':
        this.store.restoreFromRecycleBin(m.sessionId)
        return
      case 'sessionsRestoreAll':
        this.store.restoreAllFromRecycleBin()
        return
      // 回收站视图的组折叠：独立持久化，与主列表折叠互不影响。
      case 'recycleGroupCollapse':
        this.store.setRecycleCollapsed(m.workspaceId, m.collapsed)
        return
      case 'workspaceAdd':
        void vscode.commands.executeCommand('dshOne.workspace.add')
        return
      case 'workspaceCreate':
        void vscode.commands.executeCommand('dshOne.workspace.create')
        return
      case 'workspaceOpenFolder':
        void vscode.commands.executeCommand('dshOne.workspace.openFolder', m.path)
        return
      // 工作区右键菜单「在新窗口打开文件夹」：仅 forceNewWindow 与上面不同。
      case 'workspaceOpenNewWindow':
        if (typeof m.path === 'string' && m.path) {
          void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(m.path), {
            forceNewWindow: true,
          })
        }
        return
      // 复制文件夹引用：`@绝对路径` 进剪贴板（对齐会话「复制引用」的交互）；含空格的
      // 路径用引号语法（与 webview 的 fileMention 格式一致），粘贴后 tokenizer 切成 chip。
      case 'workspaceCopyFolderRef':
        if (typeof m.path === 'string' && m.path) {
          void vscode.env.clipboard
            .writeText(/\s/.test(m.path) ? `@"${m.path}` : `@${m.path}`)
            .then(() => {
              void vscode.window.showInformationMessage(
                vscode.l10n.t('Folder reference copied. Paste it into the input box to reference this folder'),
              )
            })
        }
        return
      case 'workspaceCopyPath':
        if (typeof m.path === 'string' && m.path) {
          void vscode.env.clipboard
            .writeText(m.path)
            .then(() => {
              void vscode.window.showInformationMessage(vscode.l10n.t('Path copied to clipboard'))
            })
        }
        return
      case 'workspaceOpenTerminal':
        void vscode.commands.executeCommand('dshOne.workspace.openTerminal', m.path)
        return
      case 'workspaceRemove':
        void this.removeWorkspace(m.workspaceId, m.label)
        return
      // 纯 store 本地操作。
      case 'sessionsRefresh':
        void this.store.refresh()
        return
      case 'sessionsSearch':
        this.store.setQuery(typeof m.query === 'string' && m.query.trim() !== '' ? m.query : null)
        return
      case 'sessionsSort':
        this.store.setSortOrder(m.order)
        return
      case 'sessionPin':
        this.store.setPinned(m.sessionId, m.pin)
        return
      case 'sessionUnread':
        this.store.setUnread(m.sessionId, m.unread)
        return
      case 'workspaceCollapse':
        this.store.setCollapsed(m.workspaceId, m.collapsed)
        return
      case 'workspacesCollapseAll':
        this.store.collapseAll()
        return
      case 'workspacesExpandAll':
        this.store.expandAll()
        return
      case 'sessionCopyReference':
        // 复制引用走统一命令（chat 头部 ⋯ 菜单与编辑器 tab 右键共用）。
        void vscode.commands.executeCommand('dshOne.session.copyReference', m.sessionId, m.title)
        return
      /* ---- 工作区分组（纯客户端状态，store 持久化到 globalState） ---- */
      case 'workspaceGroupSelect':
        this.store.setActiveGroup(typeof m.groupId === 'string' ? m.groupId : null)
        return
      case 'workspaceGroupCreate':
        // webview 已校验（空名/重名在输入处提示）；store 兜底拒绝，不弹宿主警告。
        if (typeof m.name === 'string') this.store.createGroup(m.name)
        return
      case 'workspaceGroupRename':
        if (typeof m.name === 'string') this.store.renameGroup(m.groupId, m.name)
        return
      case 'workspaceGroupDelete':
        this.store.deleteGroup(m.groupId)
        return
      case 'workspaceGroupSetMembership': {
        const ids = Array.isArray(m.groupIds)
          ? m.groupIds.filter((x): x is string => typeof x === 'string')
          : []
        this.store.setGroupMembership(m.workspaceId, ids)
        return
      }
      case 'workspaceGroupReorder': {
        const ids = Array.isArray(m.groupIds)
          ? m.groupIds.filter((x): x is string => typeof x === 'string')
          : []
        this.store.reorderGroups(ids)
        return
      }
      case 'serverStart':
        void this.manager.ensureStarted()
        return
      case 'openInstallPage':
        void vscode.commands.executeCommand('dshOne.openInstallPage')
        return
      default:
        return
    }
  }

  /** 行内重命名直接提交：绕过 showInputBox 弹窗，RPC 改名 + 刷新基线。 */
  private async renameSessionDirect(sessionId: string, title: string): Promise<void> {
    const url = this.store.runningUrl
    const trimmed = title.trim()
    if (!url || !trimmed) return
    try {
      await renameSession(url, sessionId, trimmed)
    } catch (err) {
      this.logger.warn(`sessions: rename ${sessionId} failed: ${errorText(err)}`)
      return
    }
    await this.store.refresh()
  }

  /**
   * 软移除 workspace（dsh web 同款语义）：modal 确认后调 host 的
   * workspace.delete——只删注册表记录，磁盘文件夹与会话日志保留，
   * 组内会话归入「未分组」。
   */
  private async removeWorkspace(workspaceId: string, label: string): Promise<void> {
    const url = this.store.runningUrl
    if (!url) return
    const confirm = await vscode.window.showWarningMessage(
      vscode.l10n.t('"{0}" will be removed from the workspace list. The folder and session records are kept; its sessions will appear under "Ungrouped".', label),
      { modal: true },
      vscode.l10n.t('Remove from list'),
    )
    if (!confirm) return
    try {
      await deleteWorkspace(url, workspaceId)
    } catch (error) {
      this.logger.warn(`workspace: remove ${workspaceId} failed: ${errorText(error)}`)
      vscode.window.showWarningMessage(vscode.l10n.t('Failed to remove workspace: {0}', errorText(error)))
      return
    }
    await this.store.refresh()
  }

  dispose(): void {
    this.managerSub.dispose()
    this.storeSub.dispose()
    this.activeSub.dispose()
  }
}
