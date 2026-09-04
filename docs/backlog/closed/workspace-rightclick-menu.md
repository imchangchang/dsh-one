# 工作区右键菜单（引用文件夹 / 分组打标 / 归档等）

## 背景与现状

侧栏 Sessions 面板里，**工作区行没有右键菜单**——只有 hover 行内按钮（新建会话 / 打开终端 / 打开文件夹 / 从列表移除，`src/ui/sessionsWebview.ts` 的 `renderWorkspaceGroup`）；会话行已有完整右键菜单（打开/改名/置顶/fork/复制引用/归档，`buildSessionMenuBody`）。

两个需求：

1. **session 引用另一个工作区的结构**（用户今天提出）：让一个工作区内的会话参考另一个工作区内部的结构，右键能直接引用工作区的文件夹。
2. **工作区分组打标入口**：见 `workspace-group-filter`，其「打标入口」方案（分组子菜单多选）天然放右键菜单里。

## 建议方案（session 内已确认对照会话「复制引用」的交互）

### 菜单项清单（已定稿 6 项）

- **复制文件夹引用**：复制 `@绝对路径` 到剪贴板。对齐会话「复制引用」的交互：粘贴进 composer 后由 tokenizer 切成 `@文件夹` chip，发送后模型拿到绝对路径 + system prompt 的显式引用提示（机制见下）——即「参考另一个工作区结构」的实现。已确认按会话引用同款方式做，不做「插入输入框」变体。
  - **机制（已核实宿主源码 @deepseek-ai/dsh 本机安装）**：dsh 的 @ 文件引用没有「注入目录结构」步骤——host 只把 `@path` 文本原样进模型，另在 system prompt 注入提示段（`FILE_REFERENCE_PROMPT`：@ 前缀路径是用户显式引用，需要时用 read 工具）；目录结构由模型自行 read/ls/glob 探索。
  - **绝对路径可行性**：补全候选（`fileReferences/list`）只给相对路径且 root 外拒绝；但 fs 工具路径解析用 `path.resolve(cwd, path)`（`dsh-fs-local` 的 `resolveLocalTarget`），**绝对路径直接生效**，`@/abs/path` 预计可行。唯一不确定项：宿主是否启用限制工作区外的 fs sandbox（可选插件，看用户宿主配置）。
  - **风险点与降级（已确认）**：开工时先发一条消息实测 `@/abs/path`；若实测不行，**该项退化为复制纯路径文本 + 让模型自行 `ls`/读取**（保留原写法）。
- **分组…**：子菜单多选勾 tag（打标入口），模型与交互见 `workspace-group-filter`（前置；本条目在其合入后开工）。
- **归档该工作区全部会话**：确认弹窗后复用现有多选归档机制（`archiveManyDone`）；演示完一个场景一键清。
- **在新窗口打开文件夹**：VS Code `openFolder(uri, { forceNewWindow: true })`（现有 `workspaceOpenFolder` 是当前窗口打开）。
- **复制路径**：纯文本路径进剪贴板。
- **从列表移除**：并入菜单，与现有 hover 按钮**双入口并存**。

**已定：hover 按钮现状全部保留**（新建会话 / 打开终端 / 打开文件夹（当前窗口）/ 从列表移除，见 `renderWorkspaceGroup`），右键菜单为其另一入口；「打开文件夹（当前窗口）」不进菜单（hover 已覆盖），菜单里只有「在新窗口打开文件夹」。

### 明确不做

- **重命名工作区**：dsh host 无 workspace 改名 RPC（现在只有 create/delete/list/archiveSession，见 `src/server/dshRpc.ts`），title 由 host 按文件夹名给；UI 层假改名不落盘。
- **「只显示此工作区」过滤**：分组下拉过滤已覆盖（`workspace-group-filter`）。

### 交互形态

沿用现有 popover 菜单机制（`showPopoverAt` + `menuFreezeActive` 冻结窗口，与会话行右键同款），不加新弹层样式。工作区行 `contextmenu` 监听 + `buildWorkspaceMenuBody`。

### 开发节奏（已定）

与 `workspace-group-filter` 分**两个 worktree**：**group-filter 先开发、先合入主线**；本条目等其合入后基于新主线开工——「分组…」子菜单需要它的分组数据模型与持久化，也避免同批改 `sessionsWebview.ts` / `chatContract.ts` / `sessionsView.ts` 等重叠文件。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`renderWorkspaceGroup` 加 contextmenu 监听；`buildWorkspaceMenuBody`（对齐 `buildSessionMenuBody` 的 popover + 冻结机制）
- `src/pure/chatContract.ts`：新 webview→host 消息类型（workspaceCopyFolderRef / workspaceArchiveAllSessions / workspaceOpenNewWindow / workspaceCopyPath；workspaceGroupSet 见 `workspace-group-filter`）
- `src/ui/sessionsView.ts`：host 侧消息处理（剪贴板、归档、新窗口打开；分组打标持久化见 `workspace-group-filter`）
- 归档复用：现有多选归档链路（`archiveManyDone` 消息）

## 变更记录

- 2026-09-04 需求提出（用户：session 参考另一工作区结构，右键直接引用工作区文件夹；确认按会话「复制引用」同款方式）。讨论后确认菜单清单与不做项；打标入口并入本菜单（前置 `workspace-group-filter`）。未开始开发。
- 2026-09-04 方案确认（与用户逐项拍板）：菜单清单定稿 6 项，hover 按钮现状全部保留（右键菜单为并存入口）；核实宿主源码——@ 引用无「注入目录结构」步骤、fs 工具绝对路径可用，降级方案保留「失败退化复制纯路径文本」；开发节奏：与 workspace-group-filter 分两个 worktree，先做 group-filter 合入后本条目再开工。
- 2026-09-05 认领（open -> doing）：worktree 开发（分支 agent/workspace-rightclick-menu）。开工前实测 @/abs/path 引用（结论见变更记录后文与测试报告）。
- 2026-09-05 开发完成（doing -> done）：6 项菜单全部落地（复制文件夹引用/分组…/归档该工作区全部会话/在新窗口打开文件夹/复制路径/从列表移除）。@/abs/path 实测通过（宿主网关探针：工作区外绝对路径被模型 read 工具成功读取，宿主未启用工作区外 fs 限制）→ 不退化为纯路径；分组… 子菜单复用 workspaceGroupSetMembership（勾选就地翻转，修掉快照往返竞态）；归档复用 openArchiveModal（从多选归档抽出）+ sessionArchiveMany → archiveManyDone。测试报告 test/sandbox/verify.workspace-rightclick-menu.report.html：11 项全 pass（harness 4 新场景 + 116 场景全量回归 + 沙盒 E2E 8 步全过 + 全量单测 470 pass + i18n OK），分支 agent/workspace-rightclick-menu，done 标记 0284273。
- 2026-09-05 主线合入后人工确认（用户验收通过）→ closed
