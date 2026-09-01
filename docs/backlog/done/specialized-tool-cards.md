# skill / cordis 专用工具卡缺失（渲染成通用工具行）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现。

## 现象

dsh web 对部分工具调用有专用卡（按 `tool.call.toolview` key 分流）：

- **SkillRow**（`dsh-client-ui-skill`，lib/client.js:111-185，key=`skill`）：Skill 图标 + 摘要 + 可展开指令卡 + Inspect。
- **CordisDefineRow / CordisRunRow / CordisActionRow**（`dsh-client-ui-cordis`，:274-569，key=`cordis_define/run/stop/undefine`）+ 侧栏脚部 CordisPanel。
- 还有 BashRow 示例卡（`dsh-client-ui-tool`，:1128 附近，key=`bash`? 待确认归属）。

dsh-one `renderTool`（webview.ts:2790）所有工具一律通用行（图标 + 动作短语 + detail），无 skill/cordis 特判（grep 无命中），指令全文与插件状态只能靠展开通用输出看。

## 涉及代码位置

- dsh web：`dsh-client-ui-skill`、`dsh-client-ui-cordis`
- dsh-one：`src/ui/chat/webview.ts`（renderTool 按 toolview key 分流）、`src/pure/chatContract.ts`（工具块加 key/指令字段，host 是否透传 toolview key 待确认）

## 变更记录

- 2026-09-01 记录 → open
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领 → doing（并行开发 session）
- 2026-09-01 开发完成 → done（worktree: agent/specialized-tool-cards）
- 2026-09-01 修复：流式输出时展开区内部滚动位置保持（14a0ca6）

## 开发完成（2026-09-01）

调研结论：dsh web 的 `tool.call.toolview` 是按**工具名**（entryKey: toolName）分发的
前端插槽，不是事件里额外的 key；host 事件流（mux `session/event` + `session.history`）
透传完整 `event.data`（含 tool/result 的 `meta`）+ `view`，数据链路可用。skill 卡数据
全齐（skill 名在 args、指令全文在 result 输出）；cordis 卡补透传 `tool/result` 的
`meta`（pluginId/packageId/pluginRunId）后即可。经用户确认：skill 卡 + cordis 全套
一次做；cordis 运行时状态（inventory readout、run 业务视图）依赖 cordis 面板数据
链路，dsh-one 没有，做静态版省略；Inspect 按钮依赖轨迹面板（无数据链路），省略。

实现（按工具名分流，对齐 dsh web tool.call.toolview）：
- `src/pure/chatContract.ts`：`ChatToolBlock` 加 `meta?`（tool/result 原样透传）。
- `src/pure/conversation.ts`：`applyToolResult` 透传 `data.meta`。
- `src/pure/toolCards.ts`（新）：skill/cordis 四类卡的派生模型（对齐 web
  card-model：skillCardModel / cordisDefineCardModel / cordisRunCardModel /
  cordisActionCardModel），纯逻辑可测。
- `src/ui/chat/webview.ts`：`renderTool` 按 `block.name` 分流 `skill` /
  `cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine` 到专用卡：
  skill 卡 = Skill 图标 + 「Skill」+ skill 名摘要 + 有输出时可展开「说明」指令卡
  （max-height 260 内滚动）；cordis_define 卡 = Code 图标 + 「注册 Cordis 插件」+
  插件名 + 用途 + 展开出 Host/Client 源码两段 + 结果段；cordis_run 卡 = 「运行/
  更新 Cordis 插件」+ pluginId · packageId + 输出平铺（非 disclosure）；cordis_stop/
  undefine 卡 = Stop/Trash 图标 + 「停止/移除 Cordis 插件」+ pluginId + 输出平铺。
- `src/ui/chat/icons.ts`：新增 SKILL_ICON / CODE_ICON / STOP_ICON / TRASH_ICON
  （官方 dsh web 图标路径）。
- `src/ui/chatView.ts`：专用卡样式（行首图标位、分隔点、错误红字、用途灰字、
  指令卡、源码段）。
- `test/toolCards.test.ts`（新）：13 例；`test/ui/scenarios.js`：6 个专用卡场景
  （含展开交互）并入 BASELINE_SCENARIOS。

自测：typecheck + 266 测试 + build 全绿；DOM 断言（WebBridge evaluate）验证 6 场景
关键元素/层级符合预期。

修复记录（14a0ca6）：用户反馈对话输出时 skill 卡展开的说明指令没法滚动。根因：
流式快照每帧全量重建消息 DOM，details 展开态有 detailsOpen 持久化，但展开区内部
滚动容器的 scrollTop 随重建归零。修复：内部滚动容器打 data-scroll-key（skill
指令卡、cordis 源码段、IN/OUT 卡、工具输出、todo 清单、上下文注入 body），
render() 重建前存档、重建后恢复，换会话随 detailsOpen 清空。WebBridge 验证
滚动位置保持 + 46 场景视觉回归无异常。

人工验收方法（dev-ui-test 隔离 VSCode，一条命令）：
```
cd <repo-root>/.worktrees/specialized-tool-cards && bash <repo-root>/scripts/dev-ui-test.sh
```
1. 弹出隔离 VSCode 窗口，扩展激活无报错（输出面板「DSH One」）。
2. 开一个会话，让 agent 调用一次 skill（如加载仓库某个 skill 的指令），聊天流里
   该调用渲染成专用卡：行首 skill 文档图标 + 「Skill」+ skill 名，点击展开出现
   「说明」指令全文卡（可滚动）；不再是通用工具行。
3. 让 agent 依次执行 cordis_define（注册插件）、cordis_run（运行）、cordis_stop /
   cordis_undefine（停止/移除）：分别渲染「注册 Cordis 插件」（可展开出 Host/Client
   源码 + 结果）、「运行/更新 Cordis 插件」（pluginId · packageId + 输出平铺）、
   「停止/移除 Cordis 插件」（pluginId + 输出平铺）。
4. 失败态：让 agent 调用一个不存在的 skill 或 cordis 操作，卡片摘要为错误输出首行
   红字、行首红点。
