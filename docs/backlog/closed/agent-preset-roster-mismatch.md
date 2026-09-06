# Agent preset 选择器与 wire 协议两处失配

## 背景与现象

调研 dsh 0.1.2-rc.1 的 agent preset 机制时发现 dsh-one 的 preset 展示逻辑与 host 实际行为有两处失配：

1. **PTC 模式本地化失配**：`src/pure/agentPreset.ts:32` 的 `SYSTEM_PRESET_LABELS` 用 `code` 作 key，但 0.1.2-rc.1 实际 preset id 是 `ptc`（`dsh-agent-presets/presets/ptc/`，目录名即 id）。后果：英文界面下 PTC 模式回退到 roster 原文（中文「PTC 模式」泄漏进英文 UI）；头部只读标签的兜底映射（`agentPresetLabel`，:91）同样失配。
2. **broken 类型不符且过滤失效**：`AgentPresetLike.broken` 声明为 `boolean`（:15），但 wire 协议里 `agentPresets/list` 的 `broken` 是 **string 原因文本**（dsh-agent-presets `lib/types/types.d.ts`）。`resolveAgentPresets`（:64）和 `defaultAgentPresetId`（:80）用 `p.broken === true` 判定，string 永不相等——**broken preset 不会被过滤，照样进选择器和默认行候选**，选了会在 select 时报错。

## 根因

0.1.2 把 preset id 从 `code` 改成了 `ptc`、broken 从布尔改成了原因串，dsh-one 的宽松 mirror 未跟进。测试（`test/agentPreset.test.ts:82`）也用 boolean 构造 broken 行，没覆盖真实 wire 形状。

## 建议方案

- `SYSTEM_PRESET_LABELS` 的 key `code` → `ptc`；`agentPresetLabel('ptc')` 等用例同步更新。
- `AgentPresetLike.broken` 改为 `broken?: string`（或 `string | true` 兼容），过滤判定改为「非空即 broken」；测试补充 string 形态用例。
- 顺带核对 l10n bundle（`l10n/bundle.l10n.json:377`）与 cordis preset 描述的同步关系不受影响。

## 涉及代码位置

- `src/pure/agentPreset.ts:8-16`（AgentPresetLike.broken）、`:26-46`（SYSTEM_PRESET_LABELS key）、`:64`、`:80`
- `test/agentPreset.test.ts:80-86`（broken 用例形态）
- 对照证据：`@deepseek-ai/dsh@0.1.2-rc.1` 内 `dsh-agent-presets/presets/ptc/`、`dsh-agent-presets/lib/types/types.d.ts`

## 变更记录

- 2026-09-05 建档：调研 kimi-cli 复刻 preset 时核实定位，记入 open/。

- 2026-09-06 认领（worktree: agent/agent-preset-roster-mismatch）→ doing

- 2026-09-06 开发完成：wire 失配修复 + 单测/harness 场景 + 报告 4 项全 pass（done 标记 8dcfd52）→ done

- 2026-09-06 主线合入（merge 19185ef）＋复测通过（typecheck/test 620 pass/build）人工确认 → closed
