# 问题卡输入框：流式快照重建 DOM 导致焦点频繁丢失、输入中断

## 背景与现象

会话正在流式输出（turn 未结束）时，agent 发起 ask_user_question 弹出问题卡；用户把光标放进问题卡底部的「其他（自定义回答）」输入框开始输入回答，输入会频繁被中断：每来一个流式快照，焦点就从输入框掉到 body，敲进去的字符不再进输入框（或正在进行的 IME 组合被直接中止），用户得重新点回输入框。

浏览器实测复现（WebBridge + test/ui/harness.html?scenario=question）：
聚焦 `.question-custom input` 后向 webview 推一条带 `running: true` 和新增消息的快照，50ms 后：
`inputStillSame: false`（输入框元素已被替换）、`activeTag: BODY`（焦点掉到 body）、草稿文本还在（value 从 answerDrafts 恢复）。元素被替换 + 焦点不恢复，即复现。

## 根因

`src/ui/chat/webview.ts` 的 `render()` 是每快照全量重建：`pending` 区块每次都用 `renderQuestion()` 新建（含自定义输入框 `<input>`，见 `renderQuestion` 3020 行附近）。流式期间 host 每 100ms 推一帧快照（`chatSession.ts` FLUSH_INTERVAL_MS = 100，chunk delta 走节流路径 `push(false)`），于是输入框每 100ms 被销毁重建一次。

同类元素都有保活/恢复逻辑，唯独问题卡没有：

- composer：`keepComposer`（hadFocus 且签名不变时保留原元素，焦点/光标/IME 组合不中断）；
- header：`keepHeader`（子代理/任务 chip 弹层锚点不被流式帧杀掉）；
- queue 编辑器：`queueFocus` 记录焦点与选区，重建后 `queueEditor.focus()` + `setSelectionRange` 恢复（render 尾 2016–2020 行）。

pending 问题卡无任何 keep/恢复逻辑，焦点随元素替换丢失。

## 建议方案

对齐 queue 编辑器做法：render() 头部记录正在聚焦的问题卡输入框（rpcId + question 下标 + selectionStart/End，甚至包括 checkbox 焦点），重建后在新输入框上恢复焦点与光标。更彻底的是把 pending 区块像 composer 一样纳入「签名未变且焦点在卡内 → 保留原元素」策略，但 pending 卡内状态（选项选中/草稿）本就走 answerDrafts，重建成本低，恢复焦点一处就够。checkbox 的焦点丢失也一并覆盖（record focused element 的通用化）。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`render()`（1535 行起）、pending 渲染（1916–1922 行）、`renderQuestion`（2965 行起）
- 参考既有恢复逻辑：queue 编辑器（1589–1593、2016–2020 行）、composer keep（1601–1652 行）
- host 节流来源：`src/server/chatSession.ts` FLUSH_INTERVAL_MS（31 行）

## 变更记录

- 2026-09-02 核实并定位根因（浏览器实测复现），未改代码。
- 2026-09-02 认领（worktree：question-card-input-focus），开始修复。
- 2026-09-02 开发完成（worktree 7f94bf5）：pending 区接入保活策略，流式快照不重建焦点内的问题卡；单选点击改就地更新高亮。typecheck + 226 tests 全绿，harness + WebBridge 实测焦点保持。→ done
