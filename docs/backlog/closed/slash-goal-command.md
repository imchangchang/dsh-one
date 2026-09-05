# `/goal` 命令不被识别（官方 0.1.2 有 dsh-command-goal）

## 背景与现象

用户（2026-09-05）在 dsh-one 面板输入 `/goal 处理当前版本发现问题…` 报「未知或格式错误的命令:/goal ...」两次。官方 dsh 0.1.2-rc.1 依赖含 `@deepseek-ai/dsh-command-goal`（package.json 依赖清单核实）——**官方支持 /goal 命令**（进入 goal 模式/设定目标）。

## 差异定位（初判）

dsh-one 面板的 slash 命令补全/解析表（`src/pure/slashCommand.ts` 或 webview 的 `/command` 表）没有 goal 命令 OR host 侧命令执行未把 `/goal` 转给 dsh（0.1.2 命令端点 `commands/execute`？2A 迁移时 slash 命令走什么线以代码为准）。两种可能：命令表缺项 / 命令透传缺失。

## 方向

1. 对照官方 goal 命令的行为与参数（`/goal <目标>`？进入 goal 模式后随消息发送？看 dsh-command-goal 源码语义），在 dsh-one 面板补支持：命令表加 goal + 透传 host；goal 模式 banner（我们已实现 goal-mode-banner——展示侧有，命令入口缺）。
2. 注意与面板已有 `:goal`/其他命令前缀的区分（官方命令用 `/`；我们面板目前支持哪些 `/` 命令以当时代码为准，漏同类的可以顺带补齐——先聚焦 goal）。
3. 保持 0.1.1 路径不变。

## 验收

- 面板输入 `/goal ...` 能进入官方 goal 语义（或与官方行为一致）；补全列表出现 goal；0.1.1 回归。

## 变更记录

- 2026-09-05 用户截图反馈 + 官方依赖核实（dsh-command-goal 存在）→ 建条目（open/）
- 2026-09-05 开发 session 认领（open → doing）：实测 0.1.2-rc.1 确认面板侧 goal 补全/透传均已存在且 wire 正确；根因=用户默认 preset（kimi，旧版 standard 拷贝）未装载 command-goal，待 worktree 开发 + 报告。

## 开发结论（2026-09-05）

- 根因：用户默认 preset「kimi」（~/.dsh/.agent-presets/kimi，0.1.1 时代 standard 拷贝）在 0.1.2 架构下缺 command-goal——0.1.2 把 command-goal 从宿主平面移进 preset 组合（standard/ptc/cordis 自带），kimi 只挂 tool-goal；其默认会话 commands/list 无 goal、/goal 返回未匹配 → 面板提示「未知或格式错误的命令」。临时 home 真 0.1.2-rc.1 复现（标准 preset 可、kimi 不可）。
- 面板侧（补全表 goal 项 + commands/execute 透传，wire=args{agentId,line,images}）核实已存在且正确；官方 0.1.2 /goal 七种输入语义逐条实测（show/create/edit/pause/resume/clear/edit-bare 报错/未知词=create）。
- 代码改动（branch agent/slash-goal-command，852e304）：未匹配时区分「面板广告的宿主内建命令」（定向提示：宿主未提供，检查 preset/dsh 版本）与拼写错（官方同款文案）；pure/slashCommand 加 slashCommandName + HOST_SLASH_COMMAND_NAMES + isHostSlashCommand，l10n 中英一条，单测 2 个，519 全绿。
- 沙盒报告：test/sandbox/verify.slash-goal-command.report.html（5 项全过，mock-llm + 真 dsh 0.1.1-rc.2；0.1.2 语义/根因在真 0.1.2 环境实测，见本条目与 ledger coverageNote）。
- 遗留：用户 kimi preset 需补 command-goal 行（`- id: command-goal/name: '@deepseek-ai/dsh-command-goal'`）才能真正用上 /goal；新增同类命令（如未来官方新命令）面板静态表同样滞后——同机制已能给定向提示，未扩展。
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed
