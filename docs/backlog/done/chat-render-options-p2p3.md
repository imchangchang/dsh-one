# chat 面板 P2/P3：字号调节 + 定时计划 chip（聚合折叠可选）

## 背景（源自 dsh-0.1.2-interaction-gaps 调研，官方 0.1.2 实现已核实）

- **字号（P2，做）**：官方 `FontSizeRow`（设置 General 区 stepper 12-17px，默认 14），持久化到 host user-settings（ui-theme namespace）→ `body.style["--dsh-content-font-size"]` → 派生 `--dsh-content-font-delta` 等 → markdown 表格用派生变量（`--dsw-font-markdown-table/head`）随正文缩放；boot 激活前写变量防首帧闪烁。全程 px CSS 变量链。**dsh-one 适配**：VS Code `configuration` 加一个设置（如 `dshOne.chatFontSize` 12-17 默认 14，或 align 官方默认）→ webview 注入 CSS 变量 → chat 内容区引用；次级文字自动 -1/-2px、表格联动（如涉及）。
- **定时计划 chip（P2，做）**：官方标题区 chip（AlarmClock 图标 + 「N 个提醒」 + chevron → 只读下拉），数据来自 schedule 服务的每会话投影（`useProjection('schedule')`，只暴露 `state.active`）；状态只有 等待中(scheduled)/已逾期(overdue)，无运行中；计划由模型调 schedule_create/list/delete 工具管理（无暂停/恢复/编辑）；到期生成一条 user message（source plugin='schedule'）插回会话；live 才准时投递，否则 overdue 待恢复补投。**dsh-one 适配**：头部 chips（子代理/后台任务/preset）加 schedule chip + 只读下拉（jobs 同款模式复制）；host 侧加投影订阅（以当时代码为准——0.1.2 协议适配已合入，schedule 投影端点在 dsh 0.1.2 服务器是否存在需先核实，若 0.1.1 服务器无该投影则降级（不显示 chip，注明））。
- **整轮聚合折叠（P3，可选）**：官方 TurnProcessNodeView（一行按钮「思考中 / N 次工具调用 · N 条消息 · N 个子代理」默认收起；turnProcesses 内存态、compact 模式下启用）。dsh-one 是逐块独立折叠。**可选**：评估成本（与阶段 2 增量更新行结构的配合）后决定——成本中等以上则不做（官方也是先行版本），报告注明决定与理由。

## 方案

按官方机制适配（字段/端点以当时代码为准，别搬旧协议）；不做项维持 interaction-gaps 的「不做」清单（宽度拖拽/子代理模型配置/模型目录搜索）。

## 验收

- 字号：设置生效（12-17 步进）、内容区与表格缩放联动、无首帧闪烁；持久化生效（设置跨 reload）。
- schedule chip：多提醒显示「N 个提醒」、只读下拉列出、scheduled/overdue 状态区分；无计划不显示 chip；0.1.1 服务器降级行为明确（不崩、不显示或注明）。
- 聚合折叠（若做）：默认收起、展开可见明细、流式增量更新下不闪。
- harness/沙盒验证 + 报告（SKILL 流程 5）。

## 变更记录

- 2026-09-05 从 dsh-0.1.2-interaction-gaps 拆分（P2 两项必做 + P3 可选评估）→ open
- 2026-09-05 认领（open → doing）：阶段 4（P2/P3）开发 session 认领，worktree slug chat-stage4-p2p3；已核实 dsh-v0.1.2-rc.1 官方 schedule 投影存在（packages/schedule/schedule projection.ts：key='schedule'，wire 视图 = 活动记录数组），0.1.1 服务器无此投影（无基线/无推送 → host 保持 undefined → 不显示 chip，降级自然生效）
- 2026-09-05 开发完成（doing → done，worktree agent/chat-stage4-p2p3 HEAD 34062c1）：P2 两项 + P3 评估决定。
  ① 字号调节：VS Code 设置 dshOne.chatFontSize（12-17 默认 14）→ chatViewHtml body CSS 变量链（官方
  --dsh-content-font-size/-delta/-size-secondary ≤14 时 −1、>14 时 −2）→ .messages 内容区随动、表格/思考块
  /上下文/命令通知读次级档；行内 code/代码块保持既有等宽与相对比例（不覆盖）。chatHtml 生成面板时把设置
  写进 <head>（激活前生效，无首帧闪烁）；运行中改设置由 ChatViewProvider.onDidChangeConfiguration →
  post chatFontSize → webview 覆盖 body 内联变量即改即效；持久化 = VS Code settings（跨 reload 由
  chatHtml 重新写入）。
  ② 定时计划 chip：官方核实（dsh-v0.1.2-rc.1 packages/schedule/schedule/projection.ts 确认存在，key=
  'schedule'，wire 视图 = state.active 数组）——但 Schedule 插件是 **opt-in**（shipped web graph 默认
  disabled，官方启用 `dsh web --patch apps/cli/config/examples/schedule/cordis.yml`），0.1.1 服务器无该投影
  → 降级不显示 chip（结构缺省，不崩）。host 折叠 schedule 投影（基线 + session/projection 帧，higher-seq-
  wins，保守校验畸形整条丢弃）；webview 头部 AlarmClock chip（官方 IconAlarmClockOutline16 stroke 图标，
  icons.ts IconPath 扩展 strokeWidth）+「N 个提醒」+ 只读下拉（状态点 scheduled/overdue、频率/本地时刻/
  相对时间、逾期行淡黄底、1s tick 就地刷新）；schedule 进入 header 保活签名（真 0.1.2 端到端暴露的 bug：
  运行中投影到达时 keepHeader 吞掉新 chip）。
  ③ P3 整轮聚合折叠评估：**不做**。官方 TurnProcessNodeView 会把一个回合的多条消息行包进单个折叠容器，
  与阶段 2 增量更新的扁平 keyed reconcileFlow（行级保活/details 折叠态按消息键持久/滚动锚定/工作流卡
  anchorSeq 插流）结构性冲突——需要把多行包进容器 FlowItem、内部再按消息 id 对账，成本中等以上；官方
  该功能也是先行版本（turnProcesses 内存态、仅 compact 模式、无持久展开态）。维持逐块独立折叠现状。
  自测：typecheck + 501 单测（新增 schedule 纯函数 4 项 + mock-llm 3 项）+ build 全绿；harness 8 个新场景
  （字号默认/17px、schedule chip 四项态 + live 到达）ui-visual 截图核对；沙盒（--instance
  chat-stage4-p2p3，容器内 dsh 0.1.2-rc.1 + overlay 启用 schedule 插件，mock-llm 场景加 schedule_create
  规则、time-context 注入过滤与工具续拍扫描修复）4 项 ledger 全 pass（F-01 schedule 真端到端、
  F-02 字号 17px 真设置注入、F-03 无计划不显示、R-01 工具回显/usage 药丸回归）；报告
  test/sandbox/verify.chat-stage4-p2p3.report.html。注：mock-llm 在 0.1.2 通路下 usage 上报未计入药丸
  （0 值，非零聚合形态由 harness turn-usage 场景覆盖）；真模型输出/真桌面 VS Code 不在本报告范围。
