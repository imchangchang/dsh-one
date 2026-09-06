# 前端共享基座建设 + 侧栏会话列表保活对账改造

记录于 2026-09-06。用户要求：彻底优化前端交互问题（对标 chat tab 页的处理方式），且**公共部分复用，避免一个问题两边重复修复**。

## 背景：两个 webview 的重复实现盘点（已核实）

chat webview（7556 行）与 sessions webview（3283 行）各自手写了一份交互基础设施：

| 基础设施 | chat 侧 | 侧栏侧 | 重复度 |
|---|---|---|---|
| 按 key 对账（增量重建） | `reconcileFlow`（通用实现） | 无——整列表每快照销毁重建 | 侧栏缺失 |
| 滚动位置保存 | keepMessages + scrollPositions 存档 + scrollFollow | 无——scrollTop 归零（`sessions-list-scroll-position-lost`） | 侧栏缺失 |
| 相位续播动画 | `syncAnimPhase` + `spinSvg` + SPIN_CELLS | 同款**逐字复制**（注释自承「同款处理」） | 100% 重复 |
| popover 三件套 | showPopover/closePopover/positionPopover（视口双向钳制+翻侧） | 同名简化版（无钳制） | chat 是超集 |
| IME 组合守护 | document 级 composition 跟踪 + `composingInside` | document 级 composingEl 跟踪 | 同模式两份 |

问题的结构同一类（手写 DOM 重建丢瞬态），修一边不治另一边——本次把公共部分抽成共享基座，侧栏在基座上重做。

## 方案

### 1. 共享基座 `src/ui/shared/`（esbuild 分别打进两个 bundle）

- `reconcile.ts`：从 chat 的 `reconcileFlow` 原样提取的通用按 key 子级对账（`{key, same, create, dispose}` + 位置修正 + 残留清理）。chat 与侧栏共用。
- `animPhase.ts`：`syncAnimPhase` + `spinSvg` + `SPIN_CELLS` + `spinnerEl`。消灭两份逐字复制。
- `composeGuard.ts`：document 级 IME 组合跟踪 + `composingInside(root)` + `onCompositionEnd(补帧)`。两份守护合一。
- `scrollKeep.ts`：滚动位置保存/恢复原语（重建前后存取 scrollTop，内容收缩交给浏览器 clamp）。chat 的高级跟随（scrollFollow 状态机）留在 chat 侧不动。
- `popover.ts`（视泛化干净度决定是否本次做）：以 chat 版为基底的 popover 控制器，清理钩子参数化（chat 的 jobsTick/scheduleTick 走 onClose 注入）；侧栏直接获得视口钳制/翻侧。若泛化牵扯过深，拆为后续条目。

### 2. chat webview 改消费共享模块（纯机械重构，行为不变）

`reconcileFlow`/`syncAnimPhase`/`spinSvg`/compose 跟踪改为 import 共享版；探针回归（输入抖动探针 + 全量单测 + 关键场景截图抽查）确认零行为差。

### 3. 侧栏主列表保活对账（对标 reconcileFlow）

- `.sessions-list` 只建一次、永不销毁——滚动位置随容器天然存活（`sessions-list-scroll-position-lost` 的彻底修复路径，本条目收口它）。
- 递归对账：列表 → workspace 组（key=`ws:${workspaceId}`）→ 组内子级（组头 key=`ws-head:*`、tag 组 key=`tag:${tagId}`、会话行 key=`s:${sessionId}`）；tag 组内再对账会话行。
- 行/组头按内容签名重建：签名含展示相关全部字段（label/unread/running/pendingInteraction/pinned/active/tagId/selection 态/description 相对时间等）；未变保活，变了原位替换。行级 hover 由 CSS 驱动自动恢复；菜单/改名/IME 冻结机制保留。
- 空态/搜索态作为特殊 key 项参与对账。

### 4. 回收站抽屉 + 组管理弹层同款

`.recycle-list` 保活 + 组/行对账；`.wsg-manage-body` 保活（或最小滚动保存），弹层内滚动位置不再丢。

### 5. 验收

- harness 补场景：折叠工作区滚动不跳、折叠标签组滚动不跳、搜索更新滚动不跳、回收站抽屉滚动不跳。
- 全量视觉回归（chat 156 场景 + sessions 场景）+ 全量单测 + 输入抖动探针回归。

## 涉及代码位置

- 新建 `src/ui/shared/`（reconcile/animPhase/composeGuard/scrollKeep[/popover]）
- `src/ui/chat/webview.ts`（改消费共享版）
- `src/ui/sessionsWebview.ts`（renderSessions 保活化 + 递归对账；回收站/组管理同款）
- 收口：`docs/backlog/open/sessions-list-scroll-position-lost.md`

- 2026-09-06 用户拍板（彻底优化 + 公共部分复用）→ open
- 2026-09-06 认领（worktree: agent/frontend-shared-foundation）→ doing
- 2026-09-06 开发完成：共享基座 ui/shared（reconcile/animPhase/composeGuard）落地 + 侧栏保活对账上线；探针实测折叠/展开/翻转滚动全保持；自测通过（typecheck/612 tests/build）+ 全量视觉回归 157 场景；ledger: test/sandbox/verify.frontend-shared-foundation.ledger.json → done

- 2026-09-06 主线合入测试通过，人工确认 → closed（合入 4e6e646）
