# commit 悬浮卡超出面板视口，被 VS Code 界面裁掉

## 背景与现象

用户测试（多行提交卡，commit `415f865` 场景）发现：git commit 悬浮卡在特定
位置会被 VS Code 界面挡住。卡永远在 chip 下方展开（`showPopover(span, body, 'below')`），
chip 靠近面板底部时，卡的底部超出 webview 视口、被 iframe 边界裁掉——看起来像
「被 VS Code 界面挡住」（只露出上半截，统计/命令行不可见）。

同样的缺陷在共享 popover 的另一侧：`'above'` 展开的菜单（锚点在面板顶部时）会超出
面板上缘被裁。

## 根因

`src/ui/chat/webview.ts` 的 `positionPopover()`（1246-1260 行）只做了水平钳制：

```ts
// Keep the popover inside the viewport: anchors near the right edge …
const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - 4)
popover.style.left = `${Math.max(4, left)}px`
// 锚点在面板顶部（sessions 头部的排序按钮）时向下展开，否则保持向上。
if (popoverPlacement === 'below') {
  popover.style.top = `${rect.bottom + 6}px`
} else {
  popover.style.bottom = `${window.innerHeight - rect.top + 6}px`
}
```

垂直方向完全不钳制、不翻转。`.popover` 是 `position: fixed`（chatViewHtml.ts 1116 行），
相对 webview iframe 视口定位，内容溢出视口只能被 iframe 边界裁掉，而 VS Code 面板
外的界面（状态栏/邻栏）正好在裁切处。

## 建议方案

`positionPopover()` 加垂直钳制/翻转（水平钳制已有）：

- `'below'`：`top = rect.bottom + 6`；若 `top + popover.offsetHeight > innerHeight - 4`，
  锚点上方空间够则翻到 `'above'`，不够则钳到 `top = innerHeight - offsetHeight - 4`。
- `'above'` 对称处理（锚点上方空间不够时翻到 `'below'` 或钳制）。
- 注意锚点是 popoverAnchor 的实时 rect，内容可能随后长高（后台任务 tick 等），
  翻转判断用当前 offsetHeight 即可；`max-height: 50vh` 已限制最高高度。

改动点预计只在 `positionPopover()`（可能连带 `showPopover` 的初始定位），
不动提交卡本身的样式与内容。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`positionPopover()` 1246-1260、`showPopover()` 1262-1273
- `src/ui/chatViewHtml.ts`：`.popover` 1115-1122（定位/尺寸约束）

## 变更记录

- 2026-09-02 用户反馈（补充问题）→ open

- 2026-09-02 认领（worktree: agent/commit-hover-card-clip）→ doing

- 2026-09-02 开发完成，自测 + 视觉验收通过 → done
