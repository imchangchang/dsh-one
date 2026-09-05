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
