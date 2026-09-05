# 0.1.2 下 ask_user_question 不再弹出问题卡（waterfall 链路缺口）

## 背景与现象

用户本机升级 dsh 0.1.2-rc.1 + 最新扩展后实测（2026-09-05）：模型调用 `ask_user_question` 时，消息流里只显示工具调用卡（`ask_user_question` 条目 + 思考/Deep diving），**不再弹出「Waiting for your answer 继续执行吗？」问题卡**（0.1.1 时期会弹，含选项/自定义回答输入/Submit）。实例：`model-selector-012` 开发会话自己调用 ask_user_question 提问「你想测什么」时同样无卡（用户截图确认）。

## 背景（2A 已知缺口）

dsh-token-auth（2A）报告已注明：0.1.2 的 approval/question 走 `$events` 水瀑布（`$events/result` 应答，`sendWaterfallResult` 已实现于 src/server/dshRpc.ts），但**端到端未验证**——沙盒 mock 配置没开 ask policy 喂不出来（基线 F-04 同限制）。用户真实环境首次暴露。

## 方向（先实测，勿猜）

1. 本机实测：让一个测试会话调 `ask_user_question`（或复现 model-selector-012 的提问），抓 `$events` 流里的问题事件真实报文（waterfall shape/字段）：对照 dsh-one host 侧消费（hostEvents/DshRPC 的 waterfall 注入逻辑）与 webview 渲染（question card 的触发条件——之前 0.1.1 链路里 question 帧如何进 webview）。
2. 修复在哪一环（host 没收到/没转发/转发 shape 错/webview 没渲染），以实测为准；`sendWaterfallResult` 应答链路的 clientId 关联按真实报文校正。
3. 与审批（approval）同链路：一并验证（若审批也不弹卡一并修）。
4. 保持 0.1.1 路径不变。

## 验收

- 0.1.2 下 ask_user_question 弹卡（选项/提交可应答、应答后 agent 继续）；审批路径（若可造）同验；0.1.1 回归。
- 报告注明实测报文与覆盖方式（本机真环境可人工开窗验收）。

## 涉及代码位置（初判）

- `src/server/dshRpc.ts`（sendWaterfallResult / $events 订阅消费）
- `src/server/hostEvents.ts`（$events 转发）
- `src/ui/chat/webview.ts`（question card 渲染）
- mock-llm 场景（若补 ask policy 场景供沙盒）

## 变更记录

- 2026-09-05 用户实测反馈（0.1.2 下 ask_user_question 无问题卡，model-selector-012 会话实例截图）→ 关联 2A 已知缺口 → 建条目（open/）

- 2026-09-05 认领（open → doing）：实测协议与渲染定位中（worktree 待建）。
