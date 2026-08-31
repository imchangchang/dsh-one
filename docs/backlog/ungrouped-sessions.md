# 未分组会话在 dsh-one 面板不可见

记录于 2026-08-31。

## 背景与现象

dsh web 的会话列表有「未分组」组：cwd 不属于任何已注册 workspace 的会话（在未注册目录跑 dsh CLI、直连 API 建会话、workspace 被移除后的残留）都归进去。dsh web 的 UI 路径产不出未分组会话（建会话必须先选 workspace），所以该组只承载外部来源的会话。

dsh-one 的会话面板则**直接丢弃**这些会话：用户在 dsh web 能看到、在 dsh-one 里完全不可见，也无法打开/归档它们。

## 根因

`src/pure/sessionTree.ts` 的 `buildSessionTree` 只渲染 workspace.sessionIds 引用到的会话，注释明确写着 "Sessions not referenced by any workspace's sessionIds are ignored"（约 87 行）。而 host 的 `session.list` 返回全部会话（不带 workspaceId 字段，分组靠 workspace.list 各 workspace 的 sessionIds 反查），未被任何 workspace 引用的会话就是未分组会话。

实测数据（2026-08-31，本机 3080）：76 个会话里约 10 个未分组，全部来自自测期 curl 直建（`/tmp/dsh-preset-probe`、`/tmp/dsh-repro`、`~/Workspaces/test` 等）。

## 建议方案

对齐 dsh web：`buildSessionTree` 收一遍"未被任何 workspace 引用"的会话，合成一个「未分组」虚拟组排在最后（无 path、不可在终端/文件夹打开、不能新建会话），会话行的打开/重命名/归档/置顶/未读等操作照常。dsh web 的未分组组头只有折叠交互，无 hover 操作按钮，可对齐。

注意点：

- 虚拟组的 workspaceId 需要哨兵值（如 `__ungrouped__`），折叠状态持久化（`sessions.collapsed`）按该值存；
- `sessionNew`、workspace 行操作（打开文件夹/终端）对该组禁用；
- `workspaceLabelFor()`（hero 的 workspace chip）对未分组会话返回「未分组」或 null。

涉及文件：`src/pure/sessionTree.ts`（buildSessionTree + 测试）、`src/ui/sessionsStore.ts`、`src/ui/chat/webview.ts`（renderWorkspaceGroup）、`src/ui/chatView.ts`。
