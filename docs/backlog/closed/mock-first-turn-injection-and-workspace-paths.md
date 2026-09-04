# mock 首轮注入适配与沙盒 workspace 路径清理

## 背景与现象

2026-09-04 Playwright 驱动实测中发现两处「沙盒/mock 行为与真实使用有偏差」的改进点：

1. **mock-LLM 首轮匹配失真**：真实 dsh 在新会话的首轮会把 skill/运行上下文作为一条 **user 消息** 注入给模型（扩展 UI 里对应的「Context injection (injected with the message)」「Runtime context」折叠卡片）。mock 的规则按「最后一条 user 消息」匹配，首轮命中的是注入文本而非用户 prompt——表现为首条 prompt 回显注入内容（「收到：A skill is a reusable set…」）、「查天气」等按 prompt 文本的规则首轮不命中。**dsh 行为本身正确**，是 mock 匹配语义与注入行为的交互没对齐。
2. **命令面板「New Session」EACCES**：沙盒把宿主 ~/.dsh 复制进容器，workspace 注册表携带宿主路径（`/Users/cgeng/…`），在容器里对这些路径 `session.create` 会 `mkdir '/Users'` EACCES。驱动已绕行（用侧边栏「New ungrouped session」建 /tmp 会话），但注册表脏数据仍在。

## 建议方案

1. mock-llm 匹配器升级：从会话消息里**过滤注入块**（识别注入标记/结构，扩展渲染的 injected context 卡片在 wire 上有对应标记），只对真实用户 prompt 文本做规则匹配；配套单测（首轮注入场景）。
2. 沙盒 mock 模式 entrypoint 清理 workspace 注册表：把 workspace 路径改写为容器内可写路径，或解析为 /tmp 下的等价目录；真模式不动。
3. 驱动脚本的暖场消息方案保留为后备。

## 涉及代码位置

- `test/mock-llm/server.ts`（匹配器）、`test/mock-llm/scenario.ts`（场景类型）
- `test/sandbox/entrypoint.sh`（mock 分支清注册表）
- `test/sandbox/verify-driver.mjs`（暖场逻辑注释更新）

## 变更记录

- 2026-09-04 由 Playwright 驱动实测发现，核实为 mock/沙盒适配问题（非 dsh、非扩展 bug），记录进 open/。

- 2026-09-04 认领（open → doing）：修复随 sandbox-testing-chain 分支完成（注入判别两类 + storages 清理 + 驱动去暖场，实测 2/2 done）；分支合入验证后转 done。

- 2026-09-04 修复随 sandbox-testing-chain 合入（merge f0b8d28）并复测通过，doing → done。
- 2026-09-04 主线合入（f0b8d28）并人工确认 → closed
