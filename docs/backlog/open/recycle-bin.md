# 回收站（软删除缓冲层）

## 背景与现象

归档在插件内不可逆（只调 `workspace.archiveSession` 打标记，插件无 unarchive 恢复入口，误归档只能去 dsh web 恢复），且**当前没有任何删除能力**（dsh 无 session 删除 API，`workspace.delete` 只是软删 workspace 注册记录）。用户想要一个回收站：介于「正常列表」和「归档」之间的可逆缓冲层，被移入回收站的会话从正常列表消失，可随时恢复；确认不要时再归档（清空/单个归档），归档才是终点动作。

## 现状（已核实）

- 归档：`workspace.archiveSession`（`src/server/dshRpc.ts`），幂等、只标记不删；插件内无 unarchive。
- 多选模式只有「归档选中的 N 个」一个操作（`src/ui/sessionsWebview.ts` `buildSelectionBar`）。
- 无 session 删除 RPC（mock 服务 RPC 全集里只有 `workspace.delete`）。
- 置顶是纯客户端状态（`sessions.pinned`），已确认不能被归档（见 `pinned-not-archivable`）。

## 建议方案（session 内已确认）

### 交互形态：方案 A —— 底部固定入口 → 独立回收站视图（用户已拍板）

- 主列表底部恒有一行「🗑 回收站 (N)」（废纸篓描边图标，非文件夹；计数为 0 时灰态），不参与排序、不随列表滚动消失（列表尾部固定）。
- 点击整行 → 切换为**回收站视图**（列表整体替换，不复用主列表滚动区；头部：‹ 返回 +「回收站 (N)」标题 +「清空回收站」，右侧「恢复全部」）。
- 回收站视图内 session **按原 workspace 分组**（组头 = 原 workspace 名 + 计数 + 折叠箭头，可折叠；原 workspace 已被软删的归「未分组」）。不做平铺。
- 已拍板不做树内就地展开（B）与顶部工具行图标（C）：三层嵌套混排、入口语义弱。

### 操作

- **移入回收站**：
  - 主列表行菜单加「移入回收站」；多选操作条在「归档选中的 N 个」旁加「移入回收站」。
  - 可逆动作，**无确认弹窗**（直接移动 + 短暂提示即可）。
  - **置顶会话不能移入回收站**（与置顶不能归档同规则：回收站清空 = 归档，置顶入站会绕过保护；host 命令层兜底，同 pinned-not-archivable 的防线）。
  - **运行中 / 未读 / 待处理可以移入**（与归档限制不同——回收站可逆；回收站行里状态点照常显示）。
- **恢复**：行菜单「恢复」→ 回原 workspace 组；视图头部「恢复全部」（用户已确认加）。均为可逆本地操作。
- **归档**（终点动作，不可逆）：
  - 回收站内行菜单「归档（不可恢复）」，modal 确认。
  - 视图头部「清空回收站」= 逐个 `archiveSession`，modal 确认并说明「归档后无法恢复，会话记录仍有保留」。
  - 清空/单个归档不额外检查运行中/未读/待处理状态（移入阶段已不限制；dsh 侧 archive 无状态校验，实现时验证）。
- **空态**：回收站视图空时显示「回收站是空的」+ 引导文案（从行菜单或多选操作移入）。

### 数据与局限（用户已接受）

- 回收站是**插件本地状态**（与 pinned 同为 UI 态；存 workspaceState，dsh 无此概念）：移入/恢复只是本地集合变化，不碰 dsh。
- 局限：dsh web 里这些会话仍显示为正常会话；跨设备不迁移；已归档会话不进回收站（不可见）。
- 移入的会话若在 dsh 侧被归档：本地集合保留该 id，回收站视图渲染时按已归档过滤（或下次刷新清理），实现时处理，不向用户暴露。

### 边界

- 不做回收站内多选（恢复全部已覆盖批量诉求；多选操作条只存在于主列表）。
- 不做「回收站内再嵌套折叠状态独立持久化」以外的高级功能；组折叠状态与主列表 workspace 折叠互不影响（建议独立存或复用现有机制，实现时定）。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：底部入口行、回收站视图渲染（分组）、行菜单/多选条扩展、清空与恢复的确认交互
- `src/ui/sessionsView.ts`：host 处理消息、本地状态持久化（workspaceState key，如 `sessions.recycleBin`）
- `src/ui/sessionsStore.ts`：回收站 id 集合 + 快照过滤（主列表排除回收站会话）+ 置顶/归档豁免校验数据
- `src/pure/sessionTree.ts`：回收站视图的树构建（按 workspace 分组）或视图层单独构建（实现时定）
- `src/pure/chatContract.ts`：webview↔host 消息（moveToRecycleBin / restoreFromRecycleBin / emptyRecycleBin + 快照字段）
- `src/extension.ts`：`dshOne.session.archive`/`archiveMany` 命令层防线扩展（回收站会话 + 置顶豁免，与 pinned-not-archivable 同层）

## 前置 / 关联

- `pinned-not-archivable`：置顶不能归档；本条增加「置顶不能移入回收站」的并行约束，两条目实现时共用 host 层防线，可合并认领。

## 变更记录

- 2026-09-04 需求提出（用户：归档不可逆、无删除，做回收站作为中间缓冲层；清空回收站 = 归档全部）；已核实现状（dsh 无 session 删除、插件无 unarchive）并评估合理（方案 A/B/C 对比设计稿 `.dev-host/recycle-bin-mock-v1.png`）。
- 2026-09-04 用户拍板：方案 A（底部固定入口 → 独立回收站视图）；置顶不能移入回收站（与归档同规则）；运行中/未读/待处理可以移入；加「恢复全部」；接受本地状态局限。未开始开发。
