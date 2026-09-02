# 聊天消息 commit hash 联动：点击打开 Git 提交视图，悬浮显示提交信息

记录于 2026-09-02。来自用户提问「对话里 git 提交的 commit hash 能不能实现联动」，已完成可行性调研（VS Code 内置 Git 插件能力 + dsh-one 渲染链路）。

## 背景与现象

chat 消息正文里出现「提交 8272a6c」这样的短 commit hash（assistant 汇报提交时常见），目前是纯文本。用户希望：装了 VS Code Git 插件时，hash 可点击跳转到对应提交（打开 git 的 commit 详情/diff 视图），悬浮（hover）显示提交信息——体验对齐 Copilot Chat 的 commit 引用。

## 已核实（可行性）

- **内置 Git 插件提供跳转命令**：`git.viewCommit(repository, historyItemId, revealUri?)`——Timeline 里「查看提交」用的就是它，打开该 commit 的 multi-diff 视图。第一个参数是 Repository 对象（不可序列化），只能宿主端 `executeCommand` 直接传对象。
- **内置 Git 插件没有 commit 专用 URI handler**：`GitProtocolHandler`（`extensions/git/src/protocolHandler.ts`）只处理 `/clone`，`vscode://git/commit` 不存在；所以点击必须走命令，不能像普通链接一样 `vscode://` 直达。
- **hover 数据可经 Git 扩展 API 拿到**：`vscode.extensions.getExtension('vscode.git').exports.getAPI(1)` → `API.repositories` / `API.getRepository(uri)`；`Repository.getCommit(ref)`（接受短 hash）返回 `Commit`（`hash` / `message` / `parents` / `authorName` / `commitDate`），够悬浮展示用，无需自己跑 git。
- **dsh-one 已有现成通路**：webview 正文走 `md()`（marked + DOMPurify，`src/ui/chat/webview.ts:542`），@会话引用已有完整先例——`dsh-session:` URI 在 `decorateSessionMentions`（webview.ts:588）里替换成 chip，点击 `post({ type: 'sessionOpen', sessionId })`，宿主在 `chatView.ts:1779 onMessage` 处理。commit 联动照此加一条消息类型即可。

## 方案（待确认后实施）

1. **识别**：`md()` 渲染后（或在 `decorateSessionMentions` 同级的 decorate 步骤）扫描消息正文文本节点中的 7–40 位 hex 串，替换为可点击 span/链接。跳过代码块（`pre > code`）与工具输出（`pre`），避免 git log 输出整屏变链接。
2. **点击**：`post({ type: 'commitOpen', sha })` → 宿主在各 git 仓库 `getCommit(sha)`（try/catch 逐个 `repositories`）命中后 `executeCommand('git.viewCommit', repo, sha)`；全部未命中 → 提示「未找到该提交」。
3. **悬浮**：渲染后发现新 sha 批量 `post({ type: 'commitInfo', shas })` → 宿主回传 `{ sha, message, authorName, commitDate }` 填入 span 的 `title`。查询结果用模块级 Map 缓存（流式每帧重建 DOM，缓存避免重复查询/重复请求），in-flight 去重。
4. **误伤控制**：7 位 hex 可能命中普通文本数字串；建议**查询确认存在后才高亮/可点击**（先灰显，回传确认后点亮），或至少点击时校验并给「未找到」反馈。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`md()`（542）、`decorateSessionMentions`（588）、正文渲染 `renderBlock`（3448，`div.innerHTML = md(...)` 在 3461）
- `src/pure/chatContract.ts`：`FromWebviewMessage`（627，加 `commitOpen` / `commitInfo` 类型）
- `src/ui/chatView.ts`：`onMessage`（1779，`sessionOpen` 分支 1820 旁加处理；commit 查询与 `git.viewCommit` 调用放宿主侧）

## 待确认

- 识别范围：正文只做，还是工具输出（`renderToolOutput` 的 `pre`，git log 输出场景）也联动？
- 误伤策略：先查后亮（推荐）还是直接可点、点击时校验？
- 多仓库工作区：sha 在多个仓库都存在时取哪个（当前打开/激活工作区优先？）。
- 悬停展示内容：完整 message（title 换行）还是 subject + 作者 + 日期一行。
- 该功能只对「当前工作区打开的仓库」内 commit 有效，仓库外的 hash 一律「未找到」——用户是否接受。

## 决策确认（2026-09-02，Sprint 2 前定稿）

- 识别范围：**仅消息正文**，工具输出（git log 场景）不联动（用户选择）。
- 误伤策略：**先查后亮**（推荐）——查库确认存在后才高亮可点，未确认的灰显。
- 多仓库：**激活仓库优先**（推荐）——sha 在多个仓库都存在时取当前打开/激活面板所属仓库。
- 悬停内容：**subject + 作者 + 日期**（推荐），单行紧凑。
- 仓库外 hash：**点击提示「未找到该提交」**（推荐）。

## 变更记录

- 2026-09-02 记录需求并核实：`git.viewCommit` 命令 + Git 扩展 exports API（`getAPI(1)` → `repository.getCommit(ref)`）可行；内置 Git 无 commit URI handler；dsh-one 复用 `sessionOpen` 通路。方案（识别/点击/悬浮/误伤控制）待确认 → open
- 2026-09-02 Sprint 2 前定稿 5 个待确认点（识别范围用户拍板仅正文，其余按推荐）
