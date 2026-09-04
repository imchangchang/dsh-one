# 工作区右键菜单（引用文件夹 / 分组打标 / 归档等）

## 背景与现状

侧栏 Sessions 面板里，**工作区行没有右键菜单**——只有 hover 行内按钮（新建会话 / 打开终端 / 打开文件夹 / 从列表移除，`src/ui/sessionsWebview.ts` 的 `renderWorkspaceGroup`）；会话行已有完整右键菜单（打开/改名/置顶/fork/复制引用/归档，`buildSessionMenuBody`）。

两个需求：

1. **session 引用另一个工作区的结构**（用户今天提出）：让一个工作区内的会话参考另一个工作区内部的结构，右键能直接引用工作区的文件夹。
2. **工作区分组打标入口**：见 `workspace-group-filter`，其「打标入口」方案（分组子菜单多选）天然放右键菜单里。

## 建议方案（session 内已确认对照会话「复制引用」的交互）

### 菜单项清单（按优先级）

- **复制文件夹引用**：复制 `@绝对路径` 到剪贴板。对齐会话「复制引用」的交互：粘贴进 composer 后由 tokenizer 切成 `@文件夹` chip，发送时 dsh host 把该目录结构注入模型上下文——即「参考另一个工作区结构」的实现。已确认按会话引用同款方式做，不做「插入输入框」变体。
  - **风险点**：现有 `@` 补全候选相对会话 cwd（`fileReferences/list`，见 `src/pure/fileReference.ts`），跨工作区引用必须发**绝对路径 token**。dsh host 是否接受 `@/abs/path`（注入目录结构）需一条消息实测；不行则退化为复制纯路径文本 + 让模型自行 `ls`/读取。
- **分组…**：子菜单多选勾 tag（打标入口），模型与交互见 `workspace-group-filter`（前置）。
- **归档该工作区全部会话**：确认弹窗后复用现有多选归档机制（`archiveManyDone`）；演示完一个场景一键清。
- **在新窗口打开文件夹**：VS Code `openFolder(uri, { forceNewWindow: true })`（现有 `workspaceOpenFolder` 是当前窗口打开）。
- **复制路径**：纯文本路径进剪贴板。
- **从列表移除**：现有 hover 按钮并入菜单；高频按钮（新建会话/终端）保留 hover 快捷。

### 明确不做

- **重命名工作区**：dsh host 无 workspace 改名 RPC（现在只有 create/delete/list/archiveSession，见 `src/server/dshRpc.ts`），title 由 host 按文件夹名给；UI 层假改名不落盘。
- **「只显示此工作区」过滤**：分组下拉过滤已覆盖（`workspace-group-filter`）。

### 交互形态

沿用现有 popover 菜单机制（`showPopoverAt` + `menuFreezeActive` 冻结窗口，与会话行右键同款），不加新弹层样式。工作区行 `contextmenu` 监听 + `buildWorkspaceMenuBody`。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`renderWorkspaceGroup` 加 contextmenu 监听；`buildWorkspaceMenuBody`（对齐 `buildSessionMenuBody` 的 popover + 冻结机制）
- `src/pure/chatContract.ts`：新 webview→host 消息类型（workspaceCopyFolderRef / workspaceArchiveAllSessions / workspaceOpenNewWindow / workspaceCopyPath；workspaceGroupSet 见 `workspace-group-filter`）
- `src/ui/sessionsView.ts`：host 侧消息处理（剪贴板、归档、新窗口打开；分组打标持久化见 `workspace-group-filter`）
- 归档复用：现有多选归档链路（`archiveManyDone` 消息）

## 变更记录

- 2026-09-04 需求提出（用户：session 参考另一工作区结构，右键直接引用工作区文件夹；确认按会话「复制引用」同款方式）。讨论后确认菜单清单与不做项；打标入口并入本菜单（前置 `workspace-group-filter`）。未开始开发。
