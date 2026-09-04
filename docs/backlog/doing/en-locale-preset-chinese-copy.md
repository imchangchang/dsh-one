# 英文界面下 preset 文案显示中文（roster 文案无 locale 区分）

记录于 2026-09-03。用户反馈：英文界面里 agent preset 相关文案（hero 选择 chip、下拉选项、头部只读标签及悬停描述）现在显示中文——「标准模式 / PTC 模式 / 极简模式 / 创造模式」及其中文描述。

## 根因（已核实）

服务端 preset.yml 只内置了中文文案，不做 locale 协商（dsh 安装目录 `config/agent-presets/*/preset.yml`：`name: 标准模式` 等，英文 locale 下也发中文）。

本仓库 commit 8b06be8（fix(i18n): preset picker must use the roster copy）为修「中文界面显示英文」把优先级改成 **roster 文案优先**：`resolveAgentPresets`（src/pure/agentPreset.ts:57）里只要 roster 提供 name 或 description 就全用 roster 原文，内置 `SYSTEM_PRESET_LABELS` 英文映射 + `vscode.l10n.t` 只在 roster 两项全缺时才兜底。于是英文界面同样拿到 roster 的中文文案，内置映射对官方 system preset 永远走不到。

头部只读标签链路同理：`ChatSessionController.agentPresetLabelFor`（src/server/chatSession.ts:887）优先查 roster options 的 label。

## 现状中一个有利的核实结果

8b06be8 同时把内置映射的英文串补进了 l10n bundle，且 zh 译文与 roster 中文文案**逐字一致**（已逐一比对 preset.yml 与 l10n/bundle.l10n.zh-cn.json：标准模式/PTC 模式/极简模式/创造模式及四条描述完全相同）。也就是说「内置映射 + t()」现在在中文界面产出的文案与 roster 一致、英文界面产出英文——当时改成 roster 优先的前提（zh bundle 没有这些 key）已不存在。

## 建议方案

对 `trust === 'system'` 且 id 命中 `SYSTEM_PRESET_LABELS` 的 preset，恢复用内置映射过 `t()`（中英文界面都对）；roster 原文只用于 user preset 和未知 id。代价：服务端日后改 preset.yml 文案时内置映射会漂移，需同步（可在条目解决时顺手加一条 check-i18n 或测试对照，非必须）。

备选：让 dsh 服务端按 locale 发文案——改在 dsh 侧，本仓库管不到，不采用。

## 涉及代码位置

- `src/pure/agentPreset.ts` — `resolveAgentPresets`（:57）的 useBuiltIn 判定
- `src/server/chatSession.ts` — `refreshAgentPresets`（:872）传 `vscode.l10n.t`
- `test/agentPreset.test.ts` — 8b06be8 加的「roster 文案优先」用例需随方案调整

## 变更记录

- 2026-09-03 用户反馈英文界面 preset 不带翻译 → 核实根因（服务端 preset.yml 固定中文 + 8b06be8 roster 优先使英文界面也拿到中文文案；zh bundle 译文已与 roster 逐字一致）→ 记入 open/（未开始修改）。

- 2026-09-04 认领（open → doing）：按条目方案实施——resolveAgentPresets 对 trust=system 且 id 命中内置映射的 preset 恢复内置映射过 t()（roster 只用于 user preset 与未知 id），随方案调整测试用例。
