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
