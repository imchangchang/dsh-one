# 流式刷新打断行内改名输入（rename 输入框无保活）

## 现象

会话头部行内改名（单击标题或头部菜单 Rename，标题原位换成输入框）期间，主窗口
有流式输出或标题投影更新时输入被中断：焦点丢失、拼音 IME 组合中止、已输入内容
丢失。用户报告的两个场景：

- **场景 A（未修）**：tab 里修改标题栏时，主窗口输出 → 改名输入被断。
- **场景 B（已修，有残留）**：问题卡「其他」自定义输入框同款问题，2026-09-01
  已修（e03efdd，dist 已含修复）。残留：pending 内容变化（新 question 出现/解决）
  或面板本地状态（翻页/最小化）变化时面板仍重建打断——语义必需重建，无法无损保活。

## 根因

webview 是手写 DOM 整帧重建渲染 + 区域保活（keep*）架构，流式快照 100ms/帧。
rename 输入框是 `startInlineRename()`（webview.ts L2658-2687）**就地**
`titleEl.replaceWith(input)` 替换，不在渲染模型里；`keepHeader` 保活条件硬排除
`.rename-input`（L3025-3031，注释「改名中的 header 不保留」——因为就地替换的
输入框在 commit/cancel 后的 render() 里不会自动还原成标题）。于是改名期间
`keepHeader` 恒为 false，每帧都走 `headerWanted && !(keepHeader && oldHeader)`
重建 header，输入框销毁重造。标题投影更新（session/projection title →
`push(true)`，chatSession.ts L1498-1503）同样触发重建。

## 建议方案

把改名状态显式化进渲染模型（与 composer 保活同款模式）：

1. 模块级 `renaming: string | null`（存输入草稿）；`renderHeader` 时若
   renaming 非空渲染 `input.rename-input`（value 从 renaming 读），否则渲染
   title span；点标题 / 菜单 Rename 置 renaming 并 render()。
2. `headerSig` 纳入 renaming 标志；`keepHeader` 允许 `.rename-input` 存在
   （去掉硬排除）——流式快照时 header 原位保留、输入框存活。
3. 改名期间把 sessionTitle 从 headerSig 剔除（title span 已被输入框替换，
   标题投影变化不影响渲染输出），标题更新也不打断改名。
4. Enter 提交（post renameSession）后 renaming=null → render() 重建还原标题；
   Esc/blur 取消同理。blur 取消语义不变：点 header 外区域（如 composer）取消
   改名是现有行为，保活化后由 renaming=null 驱动的签名变化触发重建还原。

## 残留（场景 B）

question 面板保活（keepPending，e03efdd）在 pending 内容与本地状态不变时保住
输入框。残留重建路径（新 question/解决/翻页/最小化）语义上必须重建面板，此时
输入框销毁、IME 组合丢（draft 文本经 answerDrafts 恢复）。缓解方向：重建后按
草稿恢复焦点/光标（近似 queue editor / goal input 的做法）；彻底解决需面板内部
按题粒度假保活，未评估。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`startInlineRename`（L2658-2687）、headerSig/keepHeader
  （L3013-3031）、header 重建分支（L3174-3176）、keepPending（L2898-2925）
- `src/server/chatSession.ts`：标题投影 push（L1498-1503）
- 同大类（输入 × 流式刷新并发）既有条目：`composer-input-jitter-pinned-scroll`
  （滚动位置抖动，DOM 不销毁）、`composer-sticky-in-scroller-layout`（结构性方案，
  只消抖动类，消不掉本条目这类 DOM 销毁型中断）

## 变更记录

- 2026-09-06 用户报告改名输入与 question「其他」输入被流式刷新打断 → 核实：
  场景 A 根因确凿未修；场景 B 已有 e03efdd 保活但存在内容变化重建的残留路径
  → open
