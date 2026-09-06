# 侧栏会话列表滚动位置随快照丢失（折叠工作区跳顶等）

记录于 2026-09-06。用户反馈：侧栏折叠一个工作区之后，列表会跳到最顶上。并要求系统排查侧栏同类滚动/前端交互问题。

## 根因（已核实）

`.sessions-list` 是滚动容器（`flex: 1; overflow-y: auto`，src/ui/sessionsView.ts:74），而 `renderSessions()` 每个快照都把整个列表元素销毁重建：

```ts
const oldList = sessionsPanel.querySelector<HTMLElement>('.sessions-list')
oldList?.remove()
...
const list = el('div', 'sessions-list')
```

（src/ui/sessionsWebview.ts:1228-1235）

新滚动容器 scrollTop 从 0 开始——**任何**触发快照推送的操作都会让列表跳顶，不只是折叠：

- 折叠/展开工作区（`workspaceCollapse`）、折叠/展开标签组（`sessionTagCollapse`）
- 会话状态变化（running 起停、unread 标记、待交互标记）
- 搜索过滤结果更新
- 回收站搬入/还原

侧栏没有任何 scrollTop 保存/恢复逻辑（全文件 grep 无 scrollTop/scrollIntoView）。

## 同源排查结果（侧栏全部滚动容器 + 易失状态）

同类「容器销毁重建 → 瞬态丢失」还有两处：

1. **回收站抽屉列表** `.recycle-list`（sessionsView.ts:304 同为滚动容器）：`renderSessions` 里 `oldRecycleList?.remove()` 后重建（webview.ts:1306-1309），抽屉内滚动位置同样丢失。
2. **组管理弹层** `.wsg-manage-body`（sessionsView.ts:199 滚动容器）：打开期间快照到达会 `overlay.replaceChildren(buildGroupManageCard(snap))`（webview.ts:884），弹层内滚动位置丢失（改名输入框有焦点/选区恢复，滚动没有）。

已确认**无恙**的易失状态（有对应保活机制）：

- 搜索框/排序/刷新按钮（header 只建一次，不随快照重建）
- 行内改名输入框（editingSessionId 冻结 + 重建后焦点/选区恢复）
- 会话行 ⋯/右键菜单（menuFreezeActive 冻结）
- IME 组合（composingEl document 级冻结，compositionend 补帧）
- 会话行/组角标的像素环 spinner（spinSvg 全局相位续播，与 chat webview 同款）
- 多选选中态（selectedSessionIds 是内存 Set，重建按它重渲染）
- 批量归档确认弹窗 / 回收站确认弹窗（挂 body，不随列表重建）
- 组管理弹层的改名输入（rebuildGroupManage 有焦点恢复）

## 与 chat webview 的关系

同族不同根：chat 侧的 composer 抖动是**布局层**问题（兄弟高度传导压缩滚动容器），已由 composer-sticky-in-scroller-layout 修复；本条目是**渲染对账层**问题——和 chat 侧 keepMessages/scrollPositions 存档解决的是同一类（手写 DOM 重建丢瞬态）。chat webview 已有成熟模式可搬：保活滚动容器 + 按会话存档滚动位置（`src/ui/chat/webview.ts` 的 keepMessages / scrollPositions / archiveScrollPosition）。

## 建议修复方向

- **最小修复**（覆盖本条目全部现象）：重建前记录 `oldList.scrollTop`，新列表挂载后恢复（内容收缩时浏览器自然 clamp）；回收站列表、组管理弹层 body 同款处理。
- **彻底修复**（对齐 chat 侧）：列表元素保活（只建一次），子行按 key 对账（reconcile）——改动面大得多，收益是同时消掉行级重建的其余瞬态风险。

建议先做最小修复（三个滚动容器各几行），彻底对账留给后续评估。

## 涉及代码位置

- `src/ui/sessionsWebview.ts`（`renderSessions` 1228-1235、回收站重建 1303-1310、`rebuildGroupManage` 881-893）
- `src/ui/sessionsView.ts`（`.sessions-list` 74、`.recycle-list` 304、`.wsg-manage-body` 199）
- 参考实现：`src/ui/chat/webview.ts`（keepMessages / scrollPositions / archiveScrollPosition）

- 2026-09-06 记录（用户报告折叠跳顶，根因核实 + 侧栏全面排查）→ open
- 2026-09-06 由 frontend-shared-foundation 收口：.sessions-list 保活对账（容器永不销毁，滚动随容器存活）+ 回收站抽屉同款 + 组管理弹层滚动存取；探针实测折叠不再跳顶 → done

- 2026-09-06 主线合入测试通过，人工确认 → closed（合入 4e6e646）
