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
- 2026-09-11 认领（open → doing）：阶段 4（P2/P3）开发 session 认领，worktree slug chat-stage4-p2p3；已核实 dsh-v0.1.2-rc.1 官方 schedule 投影存在（packages/schedule/schedule projection.ts：key='schedule'，wire 视图 = 活动记录数组），0.1.1 服务器无此投影（无基线/无推送 → host 保持 undefined → 不显示 chip，降级自然生效）
