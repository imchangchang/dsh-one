# 客户端持久化状态迁到 dsh 全局目录（~/.dsh）

## 背景与动机

用户提出（2026-09-06）：扩展内部一些持久化状态从数据内聚上说属于 dsh（标注的是 dsh 的会话/workspace），不该放在 VSCode 插件的 globalState/workspaceState 里，应迁到 dsh 全局目录 `~/.dsh/` 下维护。回收站状态是典型例子（虽然回收站是插件自己加的概念，但标注的对象是 dsh 会话）。

已有先例：`dsh-owned.json`（实例身份记录）就放在 `~/.dsh/` 根下，原子写 tmp+rename，见 `src/server/ownedRecord.ts`——本次迁移沿用同一套写法。dsh 本身没有对外暴露客户端状态存储 API（`~/.dsh/storages/` 是 dsh 内部插件自用），所以由扩展直接在 `~/.dsh/` 下维护自己的 JSON 文件。

## 现状盘点（全量 11 个持久化 key）

**第一类：标注 dsh 会话/workspace 的数据 → 本次搬走（用户已拍板）**

| key | 现在在哪 | 内容 |
|---|---|---|
| `sessions.recycleBin` | globalState | 回收站会话 id 集合 |
| `sessions.groups` | globalState | 分组定义+顺序 |
| `sessions.groupMembership` | globalState | workspace↔组归属 |
| `sessions.pinned` | workspaceState | 置顶会话 id |
| `sessions.unread` | workspaceState | 手动标未读的会话 id |

**第二类：纯 UI 展示偏好 → 不搬（用户已拍板）**

| key | 现在在哪 | 内容 |
|---|---|---|
| `sessions.sortOrder` | workspaceState | 列表排序方式 |
| `sessions.collapsed` | workspaceState | 主列表折叠的组 |
| `sessions.recycleCollapsed` | globalState | 回收站视图折叠组 |
| `sessions.activeGroup` | globalState | 当前选中的分组 |

**第三类：其他 → 本次不动**

- `chat.modelWindowCache`（globalState，模型上下文窗口学习缓存）：更像缓存不是状态，本次不搬，后续可再议。
- `chat.openTabs`（workspaceState）+ webview `vscode.setState`：窗口 reload 恢复凭据，天然绑定具体窗口，不能搬。

## 方案（已与用户确认）

- **文件布局：每功能一个文件**，放在扩展专属子目录下，如 `~/.dsh/dsh-one/recycle-bin.json`、`~/.dsh/dsh-one/groups.json`、`~/.dsh/dsh-one/pinned.json`、`~/.dsh/dsh-one/unread.json`，各自独立原子写（tmp+rename，复用 ownedRecord 的模式）。
- **迁移**：沿用回收站 v1→v2 的一次性迁移模式——新文件无数据时回读旧 Memento key 写回新文件，旧 key 无论是否迁移都删除（防陈旧态复活）。pinned/unread 原来在 workspaceState（per-workspace），迁移源就是当前窗口的 workspaceState。
- **语义变化（用户已接受）**：pinned/unread 从 per-workspace 隔离变为跨窗口全局共享，顺带修正「新开窗口置顶/未读丢失」的同类问题（与回收站 v1 的坑同根，见 closed/recycle-bin-persistence）。
- **并发**：多个 VSCode 窗口（甚至不同 user-data）共享同一份文件，写者之间 last-writer-wins；每次写前重读文件合并可降低丢失率（实现时定，至少保证原子写不产坏文件）。读失败/坏 JSON 一律按空集合降级，不阻断激活。
- Memento 是同步 API、文件 IO 是异步：构造期先用空集合起步，激活早期异步载入完成后合并进 store 并刷新快照（注意别覆盖载入前用户已做的操作）；或 activation 里先 await 读文件再构造 SessionsStore（激活路径同步性改动最小，实现时权衡）。

## 涉及代码位置

- `src/ui/sessionsStore.ts`：五个 key 的读写（构造器迁移逻辑 + 各 persist 方法）
- `src/extension.ts`：SessionsStore 构造注入（globalState 参数改为文件 store）
- `src/pure/recycleBinState.ts`：`resolveRecycleIds` 迁移决策可复用思路（新旧源并存时新源优先）
- `src/server/ownedRecord.ts`：原子写/降级处理先例，可抽共用或照抄模式
- 测试：`test/recycleBinState.test.ts`、sessionsStore 相关单测（构造器现在是同步的，迁文件后注入方式变化要同步改测试）

## 变更记录

- 2026-09-06 用户提出（内部持久化状态应放 dsh 全局目录，回收站为例）；逐个盘点 11 个 key 后用户拍板：回收站 + 分组（定义/归属）+ 置顶 + 未读搬走，视图偏好（排序/折叠/回收站折叠/选中组）不搬，modelWindowCache 本次不动；文件布局定为每功能一个文件 → 建条目（open/）

- 2026-09-06 认领（worktree: agent/client-state-to-dsh-home；本次把 tags/sessionTags 一并纳入落盘迁移，供派生脚本 --tag 归组）→ doing

- 2026-09-06 开发完成（doing → done，worktree client-state-to-dsh-home，branch agent/client-state-to-dsh-home，HEAD fecb3a8）：五组客户端状态（回收站/分组+归属+选中组/标签组+归属/置顶/未读）迁到 ~/.dsh/dsh-one/*.json——用户中途拍板选中组（activeGroupId）也进 groups.json（"标签页本身属性类型的需要保存"），排序/折叠类视图偏好留 Memento。新增 src/pure/dshStateFile.ts（解析/三态决策/字段级合并）+ src/ui/dshStateStore.ts（原子写/读-合-写串行队列/fs.watch 热重载），sessionsStore 改 async create()（首启旧 Memento 迁移：写成功才删旧 key）；mk-sessions-modern.py 加 --tag（一次派生 = 侧栏一个标签组）。子代理评审抓出 1 blocker（emptyTagFile 缺预设组导致全新安装打组静默不落盘，6f52f30 修）+ 2 should-fix（回收站 mutator 全量语义误删并发窗口条目，e5a73ad 修）均已修复回归。自测全绿（typecheck/test 638/build）；沙盒 E2E 7 项全 pass（verify.client-state-to-dsh-home.ledger.report.html：F-01 脚本写文件热重载出组、F-02 UI 写回文件含全新安装场景、F-03 迁移单测覆盖+边界说明、F-04 重启纯文件恢复、R-01~R-03 回归）。注意：code-server 不水合 Memento（沙盒全局限制），真实旧版→新版迁移需在桌面 VS Code 人工验收（dev-ui-test）。评审 nits 留档：watcher 出错后热重载静默失效无恢复；writePending 期间 reload 跳过无补偿重试（极端时序漏一次，下一次事件追平）。
