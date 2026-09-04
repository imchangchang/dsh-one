# 等待插话气泡：与落地后消息渲染不一致，多行时 spinner 远离气泡

记录于 2026-09-03。用户反馈：插话（steering 待落地）时对话流末尾的「气泡 + 左侧处理中圆圈」与插话落地后的正式用户消息渲染不一致——同一段文本待落地时提前换行（如「比如说remote ssh这个插件」被拆成两行），且 spinner 对整列内容（附件/气泡/引用摘要）垂直居中，多行时容易贴在远离气泡的位置。

## 现象（已用探针复现+实测）

676px 消息列宽，文本「比如说remote ssh这个插件」，无附件：

| 状态 | 气泡宽 | 行数 | spinner |
|---|---|---|---|
| 待落地（当前实现） | 206px | 2 行 | 距气泡左缘 17px、对整行 body 垂直居中 |
| 落地（正式用户消息） | 217px | 1 行 | 无 |

用户截图同款：待落地气泡「比如说remote ssh这个插 / 件」两行，落地后是完整一行。

## 根因（已核实）

`renderSteeringItem`（src/ui/chat/webview.ts:3377）的结构是：

```
row (.msg.user.steering-pending)  [row flex; justify-content: flex-end; gap: 6px]
  ├── span.spinner
  └── body (.msg.user)            [column flex; align-items: flex-end]
       ├── attachments（若有）
       ├── bubble (max-width: 85%)
       └── summary（引用摘要，若有）
```

气泡的 `max-width: 85%` 是百分比，按**包含块（body）宽度**解析；但 body 作为 row flex 的子项是 shrink-to-fit（宽度=内容宽）。于是 85%×内容宽 < 内容宽，气泡被压窄提前换行。正式消息的 `.msg.user` 是 `.messages` 列 flex 的子项（默认 stretch），宽度=整行 676px，85% 按整行解析（574px）→ 不换行。这是两态不一致的直接原因。

spinner 是 row 的 flex 子项、`align-items: center`，只对整列 body（附件+气泡+摘要）垂直居中——附件/摘要存在时 spinner 贴着的高度不在气泡上，多行时更明显。

## 建议方案（已用静态探针验证）

改 `renderSteeringItem`：row 保持 `.msg.user` 的 column 布局（不再改 row），把 spinner+bubble 包成一行：

```
row (.msg.user.steering-pending)  [column flex; align-items: flex-end]
  ├── attachments（若有）
  ├── line (.steering-line)       [row flex; justify-content: flex-end; gap: 6px; width: 100%]
  │    ├── span.spinner
  │    └── bubble
  └── summary（若有）
```

- `.steering-line` 撑满行宽 → 气泡 `max-width: 85%` 按整行解析，与落地态逐像素一致（探针实测：两者同为 180px 单行，行数、位置一致）。
- spinner 只对气泡行垂直居中 → 永远紧贴气泡（间距即 gap 6px），不再被附件/摘要带偏。
- `.msg.user.steering-pending` 的旧 row 覆盖规则删除，换成 `.msg.user .steering-line` 规则。

无文本无附件仍是「(empty message)」气泡进 line；有附件无文本时 line 只含 spinner（保留处理中指示）。

## 涉及代码位置

- `src/ui/chat/webview.ts` — `renderSteeringItem`（:3377）
- `src/ui/chatViewHtml.ts` — `.msg.user.steering-pending`（:178-183）+ 新增 `.steering-line`
- `test/ui/scenarios.js` — `steering-pending` 场景期望描述无需大改（「气泡左侧紧贴圆圈」关系不变）

## 变更记录

- 2026-09-03 用户反馈「插话中 UI 与插话完成后的气泡渲染不一致，多行时转圈 UI 容易离气泡较远」→ 探针复现（676px 列宽：待落地 206px/2 行 vs 落地 217px/1 行）→ 核实根因（气泡 max-width:85% 按 shrink-to-fit 的 body 宽度解析；spinner 对整列 body 居中）→ 静态探针验证修复方案（`.steering-line` 撑满行宽后两态一致、spinner 距气泡 6px 居中）→ 记入 open/（未开始修改）。
- 2026-09-04 认领（open → doing），按条目方案在 worktree `steering-pending-bubble` 开发。
- 2026-09-04 开发完成（doing → done）在 worktree `steering-pending-bubble`：按方案重构 `renderSteeringItem`（spinner+bubble 包进 `.steering-line`）+ CSS 换 `.msg.user .steering-line` 规则 + scenarios 新增 `steering-pending-narrow`；自测全绿（typecheck / 386 项 test / build）；测试报告 `test/sandbox/verify.steering-pending-bubble.report.html`（F-01 布局 / F-02 676px 单行 pass；R-01 conversation、R-02 真 dsh+mock-llm 回显 pass）。
- 2026-09-04 主线合入（merge 后人工确认，用户审报告通过）→ closed
