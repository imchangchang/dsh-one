# 流式刷新打断输入：全量输入点保活覆盖缺口

## 现象

用户报告两类：会话头部行内改名期间主窗口有流式输出/标题投影更新时输入被断
（焦点丢失、拼音 IME 组合中止、已输入内容丢失）；问题卡「其他」自定义输入框
同款问题（2026-09-01 已修 e03efdd）。全量 review 后确认同类缺口还分布在其他
多个输入点，见下。

## 根因

webview 是手写 DOM 整帧重建渲染，流式快照约 100ms/帧。输入点靠两种机制扛刷新：

1. **保活**（签名不变则原元素不动）：只有 composer（keepComposer）、header
   （keepHeader）、pending 面板（keepPending）、todo 卡、blank hero 接入；
2. **恢复**（重建后回填文本 + 恢复焦点/选区）：queue editor、goal input、侧栏
   行内 rename 用这套。

**恢复救不了 IME 组合**：元素销毁瞬间浏览器的 composition 会话即中止（组合窗
口关闭、已输入的拼音串被强制上屏或丢弃），重建后 focus + setSelectionRange 只
能保住文本与光标。凡是有焦点恢复逻辑的输入点，都意味着保活缺失。

## 全量输入点 review（chat webview + sessions webview）

| 输入点 | 位置 | 刷新下行为 | 结论 |
|---|---|---|---|
| composer textarea | chat L6651 | keepComposer 保活（签名不变+焦点在内） | ✓ 无缺口 |
| header 行内改名 | chat L2663 | keepHeader 硬排除 `.rename-input`，每帧必重建 | ✗ 无保活（场景 A） |
| queue editor | chat L3890 | queue 区无 keep，每帧重建；queueEditDrafts 恢复文本 + queueFocus 恢复焦点/光标 | ✗ IME 组合每帧断 |
| goal 编辑 input | chat L4284 | goal bar 无 keep，每帧重建；goalDraft + goalFocus 恢复 | ✗ IME 组合每帧断 |
| 面板最小化「在聊天里说」输入 | chat L6217 | keepPending 面板级保活覆盖（焦点在内+签名不变时不动） | ⚠️ 无 draft 存储：pending 内容变化面板重建时文本丢 |
| question 选项 checkbox | chat L6401 | checked 从 answerDrafts 恢复 | ✓ 非文本输入 |
| question「其他」自定义输入 | chat L6461 | keepPending + answerDrafts | ✓（e03efdd；残留：pending 内容/本地状态变化时面板必重建，IME 断） |
| 侧栏搜索框 | sessions L545 | header 只建一次，DOM 持久 | ✓ |
| 侧栏建组弹层输入 | sessions L782 | popover 锚在持久 groupBar，快照刷新只 reposition 不重建 | ✓ |
| 侧栏组管理·新建组 | sessions L911 | 每次快照到达 rebuildGroupManage 全弹层重建（L2658，仅拖拽中豁免）；newGroupDraft 恢复文本，无焦点恢复 | ✗ IME 断 + 焦点丢 |
| 侧栏组管理·重命名 | sessions L990 | 同上 | ✗ IME 断 + 焦点丢 |
| 侧栏组管理 checkbox | sessions L1091 | 非文本 | ✓ |
| 侧栏行内 rename | sessions L1610 | 重建后恢复焦点+选区（L1283-1290），editDraft 恢复文本 | ✗ IME 组合断（重建瞬间） |
| 侧栏多选 checkbox | sessions L2134 | 非文本，状态在 selectedSessionIds | ✓ |
| host showInputBox 等弹窗 | — | 不在 webview 内 | ✓ 不受影响 |

侧栏在流式期间同样会周期性重建：sessionsStore 的 activity/status 变化 →
refreshSoon → rebuildModel → `store.onDidChange → pushSessions` →
renderSessions 整列表重建。

## 修复方向

1. **通用兜底（建议先做）**：render 入口检测 composition 中的焦点元素——正在
   IME 组合时强制保活焦点所在区域（或整帧推迟到 compositionend 再渲染）。一处
   改动覆盖全部现有与未来输入点，配合已有的文本恢复逻辑即可。注意语义：签名
   变化（pending 内容真变了）也**推迟**重建而非跳过，compositionend 后下一帧
   自然落地。
2. **逐点补齐保活**（根治，按需）：给 queue 区、goal bar、侧栏组管理弹层、侧栏
   行内 rename 加与 composer 同款的签名保活；header rename 按原条目方案显式化
   渲染状态（renaming 草稿进 headerSig、去掉硬排除、改名期间 sessionTitle 不进
   签名）。
3. **补 panel-answer 草稿**：最小化「在聊天里说」输入值存进 draft（answerDrafts
   同款或独立 map），面板重建时恢复文本。

## 涉及代码位置

- `src/ui/chat/webview.ts`：keep 判定与清理循环（L2902-3061）、恢复点（queueFocus
  L2887-2891 / L3514-3516、goalFocus L2893-2897 / L3519-3523）、startInlineRename
  （L2658-2687）、renderQueueItem（L3885-3919）、renderGoalBar（L4271-4319）、
  renderPanelAnswer（L6215-6237）
- `src/ui/sessionsWebview.ts`：renderSessions 重建 + rename 恢复（L1170-1290）、
  rebuildGroupManage 触发（L2651-2658）、buildGroupManageGroups（L896-957）、
  buildGroupManageRow（L960-1010）
- `src/server/chatSession.ts`：标题投影 push（L1498-1503）

## 变更记录

- 2026-09-06 用户报告改名输入与 question「其他」输入被流式刷新打断 → 核实：
  场景 A 根因确凿未修；场景 B 已有 e03efdd 保活但存在内容变化重建的残留路径
  → open
- 2026-09-06 全量 review 两个 webview 的全部输入点（14 处）：新增发现 queue
  editor / goal input / 侧栏组管理两输入 / 侧栏行内 rename 共 5 处 IME 中断缺口、
  panel-answer 1 处文本丢失缺口 → 条目改为总条目并重命名
  （rename-input-stream-interrupt → input-keepalive-coverage-gaps）
