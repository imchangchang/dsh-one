# 回收站抽屉提手横条看似没用（点击无反应）

## 背景与现象

用户实测（2026-09-06）：点开回收站抽屉后，顶部有一个短的小横条（36px × 4px 的圆角横线），看着不知道是什么、点击也没反应，感觉「没有什么用」。

## 根因（已核实）

横条是抽屉的**拖动提手**（`.recycle-drawer-handle` + `.recycle-drawer-grip`，`src/ui/sessionsWebview.ts` `renderDrawerHandle`/`onDrawerDragStart`），功能是：

- 上拉：抽屉从半高（50%）扩到 90%（两档吸附）；
- 下拉低于 35% 松手：收起抽屉；
- **只点不拖：什么都不做**（代码里明确 `只点提手未拖动：保持当前档位`）。

问题在于这个交互不可发现：无悬停提示、点击无反馈；而「收起」已有更明显的入口（抽屉头 ▼ Back 按钮、点击抽屉外、Esc），提手唯一独有的价值只剩「扩到 90%」，藏在拖动手势后面，用户自然当它没用。

## 方案候选（未定）

1. **去掉提手**：收起靠 ▼ Back / 点外部 / Esc（已足够），放弃「扩到 90%」档（或把扩大能力挪到别处，如双击抽屉头）。最省事，界面少一个谜之元素。
2. **保留拖动 + 点击也生效**：点击提手在 50% ↔ 90% 两档间切换（拖动逻辑不变），并加悬停提示。横条变得有点击用途，扩大能力保留。
3. **保留现状**：它本来就能拖，只是不可发现——加 `data-tip` 悬停提示说明「上拉扩大 / 下拉收起」即可。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`：`renderDrawerHandle` / `onDrawerDragStart`（`DRAWER_HEIGHT_DEFAULT`/`EXPANDED`/`CLOSE_BELOW` 常量）
- `src/ui/sessionsView.ts`：`.recycle-drawer-handle` / `.recycle-drawer-grip` 样式
- `test/ui/scenarios.js`：`sessions-recycle-drawer` 场景期望里写了「顶部提手横条（grab 光标区）」，改方案需同步更新

## 变更记录

- 2026-09-06 用户实测反馈（抽屉顶部横条不知道有什么用）→ 核实代码：横条是纯拖动提手、点击无反应，交互不可发现 → 建条目（open/）
- 2026-09-06 认领（worktree: agent/recycle-drawer-polish）→ doing。用户拍板做法：**点横条 = 收起抽屉**（拖动扩/收逻辑保留），并加悬停提示。与 recycle-entry-quick-actions 同 worktree 开发。
