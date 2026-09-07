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

- 2026-09-06 开发完成（doing → done，worktree client-state-to-dsh-home，branch agent/client-state-to-dsh-home，HEAD fecb3a8）：五组客户端状态（回收站/分组+归属+选中组/标签组+归属/置顶/未读）迁到 ~/.dsh/dsh-one/*.json——用户中途拍板选中组（activeGroupId）也进 groups.json（"标签页本身属性类型的需要保存"），排序/折叠类视图偏好留 Memento。新增 src/pure/dshStateFile.ts（解析/三态决策/字段级合并）+ src/ui/dshStateStore.ts（原子写/读-合-写串行队列/fs.watch 热重载），sessionsStore 改 async create()（首启旧 Memento 迁移：写成功才删旧 key）；mk-sessions-modern.py 加 --tag（一次派生 = 侧栏一个标签组）。子代理评审抓出 1 blocker（emptyTagFile 缺预设组导致全新安装打组静默不落盘，6f52f30 修）+ 2 should-fix（回收站 mutator 全量语义误删并发窗口条目，e5a73ad 修）均已修复回归。自测全绿（typecheck/test 638/build）；沙盒 E2E 7 项全 pass（verify.client-state-to-dsh-home.ledger.report.html：F-01 脚本写文件热重载出组、F-02 UI 写回文件含全新安装场景、F-03 迁移单测覆盖+边界说明、F-04 重启纯文件恢复、R-01~R-03 回归）。注意：code-server 不水合 Memento（沙盒全局限制），真实旧版→新版迁移需在桌面 VS Code 人工验收（dev-ui-test）。评审 nits 留档：watcher 出错后热重载静默失效无恢复；writePending 期间 reload 跳过无补偿重试（极端时序漏一次，下一次事件追平）。 后应用户要求补全程决策日志（92ed06d：create 逐模块权威来源/迁移结果、IO 层写失败原因/坏文件/watch 状态、reload 跳过原因与变更模块，Output 频道「DSH One」client-state 前缀；沙盒 output_logging 已实证）并用最新 vsix 重跑 E2E 全过。

## 边界条件推演（2026-09-06，用户要求；难测场景主要靠推演兜底）

按生命周期分五类。每条标注依据：[代码]=逐行核实过；[E2E]=沙盒验证过；[单测]=有测试；[推演]=纯推理。

### 一、文件与 dsh 实际会话不一致
- json 有、dsh 没有（幽灵 id）：回收站自动清账（pruneRecycleBin 按 knownSessionIds 对文件清账，基线就绪后执行）[代码][E2E]；pinned/unread/sessionTags/membership 惰性保留不渲染——归档会话恢复后状态原样回来，误清代价大于留存成本 [代码]
- dsh 有、json 没有：新会话常态，无状态平铺 [推演]
- sessionTags 指向不存在的组 id：parse 时 sanitizeSessionTagIds 直接丢弃 [代码]
- activeGroupId 指向不存在的组：parse 时回落 null（全部工作区）[代码]
- 同 id 同时在 pinned 和 recycleBin（只能手改文件造成）：回收站优先，行进抽屉不渲染主列表，恢复后 pin 还在 [推演]
- json 里塞大量假 id（手改）：惰性不渲染，无性能问题（渲染只遍历基线会话）[推演]

### 二、启动与迁移
- 迁移中途进程被杀：粒度是单模块——已迁模块文件权威+旧 key 已删，未迁模块旧 key 还在、下次启动重迁，无中间坏态 [代码]
- 两个窗口同时首启迁移：双方都走 merge（并集/按 id 合并），不互丢；activeGroupId 先写的赢（prev ?? value）[代码][单测]
- 文件存在但损坏 + 旧 Memento 已删：fresh start，状态丢失；有 `did not parse ... treated as missing` warn；下一次写自愈覆盖坏文件 [代码]
- 空文件/空字符串文件：parse 失败按缺失处理，同上 [代码]
- 旧版新版并存（罕见，如多 user-data-dir 版本不齐）：旧版继续写 Memento，新版文件权威后下次启动把旧版写回的 key 当陈旧值再删——旧版窗口里的新操作不进文件、重启新版后丢失。VS Code 正常统一升级不会遇到 [推演]

### 三、运行中读写并发
- 同窗口连续快操作：promise 队列串行，读-合-写不丢 [代码][单测]
- 跨窗口/脚本同时写同一文件：last-writer-wins，丢后到的那一个增量（窗口=读文件到 rename 之间，毫秒级）。人手工几乎撞不上；脚本批量写 tags 与插件同时写 tags 是主要暴露面，双方都读-改-写把概率压到最低 [代码][推演]
- writePending 期间收到 watch 事件：跳过 reload（防读到写前旧值回退内存），写落定的 rename 事件会补一次；有 skip 日志 [代码]
- 上述跳过的极端变体：外部写恰好落在插件读-写之间被覆盖、其事件又被 skip → 无补偿，该增量真丢。需三方同毫秒撞同一文件，接受的固有代价 [推演]
- persist 写失败（磁盘满/权限）：内存态照常、warn 两条（io 层原因 + persist 层模块）；之后任何 watch 事件触发 reload，文件权威会把内存里未落盘的变更抹掉——"我打的组消失了"类现象查 warn 日志 [代码]
- 自己的写回响：debounce 后读文件与内存逐模块相等 → 不重建不通知不打日志 [代码][E2E：自己的写不产生 reload 日志]

### 四、外部扰动
- 手改坏 JSON/版本号不符：load/reload 按缺失处理（保持内存/走迁移）+ warn；update 写时 prev=empty 覆盖自愈 [代码][单测]
- ~/.dsh/dsh-one 目录被整个删掉：写路径 mkdir 自愈；但 watcher 挂旧 inode 静默失效（热重载死到重启）——留档 nit，低频 [推演]
- tmp 残留（写一半被 SIGKILL）：随机后缀 tmp 文件不影响 load（只读固定文件名）；极少量残留无害 [代码]
- watcher error（inotify 耗尽等）：warn 日志，热重载失效无自动恢复——留档 nit [代码]

### 五、版本切换
- 升级到本版：首启迁移，逐模块日志可查 [E2E（日志实证）]
- 降级回旧版：Memento key 已删，状态不回迁（条目拍板接受）[代码]
- 新版插件 + 旧版脚本/无插件 + 新脚本：脚本写的文件没人读就静等；新版启动即文件权威，向后兼容 [推演]

结论：无新发现的 blocker/should-fix；三个已接受的代价（同毫秒互丢、writePending 极端变体、目录删除后 watch 死）都有日志或留档，修法都是重启窗口/重新操作。

- 2026-09-06 主线合入（dev-merge 复测 typecheck/test/build 全绿），用户在 Windows 实测无问题 → closed
