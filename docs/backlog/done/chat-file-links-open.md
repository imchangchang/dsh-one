# 对话消息里的文件链接可点击打开（含工作区外文件）

记录于 2026-09-02。来自用户反馈：参考会话「核算硬件成本可行性分析」里 assistant 输出的 `[docs/hardware-cost-estimate.md](/Users/cgeng/Workspaces/POV/aibrain-app/docs/hardware-cost-estimate.md)` 这类链接，点击无反应。用户当前 VS Code 窗口的文件夹是别的工作区（dsh-one），预期点击后在当前窗口直接打开工作区外的目标文件。

## 背景与现象

- webview 正文走 `md()`（marked + DOMPurify，`src/ui/chat/webview.ts:565`）。绝对路径（`/Users/...`）能渲染成蓝色链接，但点击没有任何动作。
- 经实测 marked + 现有 `ALLOWED_URI_REGEXP`（`webview.ts:568`）：`/abs/path`、`AGENTS.md`、`../x.md`、`~/x.md` 的 href 能存活；**小写字母开头的相对路径（`docs/foo.md`）和 `file://` 链接的 href 会被 DOMPurify 剥掉**，渲染成纯文本不是链接；Windows 绝对路径（`C:/...`，marked 会输出 `C:%5C...`）同样被剥。

## 根因

1. **点击拦截只认 http/https/mailto**：`webview.ts:337-349` 的捕获阶段 click handler 对所有 `a[href]` 都 `preventDefault`，但只对 `^(https?|mailto):` 的 href `post({type:'openExternal'})`；其余（含文件路径）直接吞掉——表现为「点了没反应」。
2. **DOMPurify 白名单不放行文件类 href**：`ALLOWED_URI_REGEXP` 的字符类 `[a-z+.-]`（a-z、+、.、-）与 `[a-z+.-:]`（多一个 `.`–`:` 区间）导致「小写字母开头 + 含 `/`」的相对路径不匹配（`/` 落在 `.`–`:` 区间里）。

## 现状：打开工作区外文件的能力已具备

- 宿主侧 `openFileInEditor`（`src/ui/chatMessages.ts:360`）＝ `vscode.window.showTextDocument(vscode.Uri.file(path))`，注释已写明支持「含工作区外的外部文件」，产物/附件 chip（`producedOpenFile` / `openAttachmentFile`）就在用它。`showTextDocument` 打开工作区外文件是 VS Code 标准能力，无需用户操作（不会切工作区）。
- 会话所属 cwd 在 `SessionSummary.cwd`（`src/server/dshRpc.ts:25`，session.list 基线字段），但 `toSessionInput`（`src/ui/sessionsStore.ts:23`）映射时丢弃了它；`SessionInput`（`src/pure/sessionTree.ts:25`）也没有该字段——相对路径解析基准需要补透传。

## 建议方案

1. **webview 点击处理**（`src/ui/chat/webview.ts:337`）：http/https/mailto 分支后加「文件路径」分支——`file://`、`/`、`~`、`./`、`../`、`[A-Za-z]:` 及纯相对路径，`post({type:'openPath', path: href})`；`dsh-session:` 残余保持现状只拦不跳。
2. **sanitizer 放行**（`webview.ts:568`）：把 `file:` 加入白名单 scheme；相对路径类 href 需放开——倾向 `afterSanitizeAttributes` 钩子自行判定（保留 `javascript:`/`data:` 等危险 scheme 的默认拦截），而不是继续堆正则。
3. **contract**（`src/pure/chatContract.ts`）：加 `{ type: 'openPath'; path: string }`。
4. **host handler**（`src/ui/chatMessages.ts` 文件域）：归一化 href（`decodeURIComponent`、`file://` → `Uri.fsPath`、`~` → home、相对路径先按附着会话 cwd 解析、再兜底当前 workspace root），`fs.stat` 存在性检查后 `showTextDocument`，文件不存在沿用 `openFileInEditor` 的报错文案。查看目录路径时提示（可选：`revealFileInOS`）。
5. **cwd 透传**：`SessionInput.cwd?` + `toSessionInput` 带上 `s.cwd`，host 从 `store.rawList()` 取附着会话 cwd。
6. 可选：用户气泡的 @文件 ref-chip（`webview.ts:597` `referenceChip`，现为「纯展示不可点」）同样接 openPath。

## 涉及代码位置

- `src/ui/chat/webview.ts`（click handler、`md()` 白名单、`referenceChip`）
- `src/pure/chatContract.ts`（FromWebviewMessage 新类型）
- `src/ui/chatMessages.ts`（文件域 handler，复用 `openFileInEditor`）
- `src/ui/sessionsStore.ts` + `src/pure/sessionTree.ts`（SessionInput 透传 cwd）

## 变更记录

- 2026-09-02：open 条目。已核实：渲染/点击链路与宿主打开能力；工作区外文件可直接打开；相对路径需会话 cwd（基线有、未透传）。

- 2026-09-02：认领（open → doing），worktree 开发中。

- 2026-09-02：开发完成（doing → done），自测通过（typecheck/test/build），待人工 dev-ui-test 验收后合入。
