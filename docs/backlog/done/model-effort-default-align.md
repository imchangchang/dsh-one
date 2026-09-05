# 模型推理等级 UI 与官方 web 完全对齐：Default 档 + 去掉 description

## 现象（2026-09-06 用户反馈，dsh 0.1.2-rc.1 + dsh-one 1.1.0）

官方 DSH web UI 的模型选择器里，Kimi 模型（如 Kimi K3）的推理等级下拉首项是 **Default**（未声明 `defaultEffort` 的模型），触发按钮显示「Kimi K3 · Default」；而 dsh-one 的模型菜单里下拉只有 Low/High/Max 且无选中项，footer pill 也只显示「Kimi K3」，缺「Default」后缀。

## 差异清单（对照 dsh-client-ui-model-selection 已核实）

| # | 位置 | dsh-one 现状 | 官方行为 |
|---|---|---|---|
| 1 | `src/ui/chat/webview.ts` `renderModelMenuEfforts`（~2320 行） | 下拉只列档位，无 Default 项；Kimi K3 下无选中项，选中档位后无法回 Default | 无 defaultEffort 时首项为 Default（effort undefined），可选中；选它 = selectModel 不带 reasoningEffort 清除显式档位 |
| 2 | `src/server/modelCatalog.ts` `modelLabelOf`（107 行） | `if (effortId)` 才追加档位名 → Kimi K3 pill 显示「Kimi K3」 | 显示「Kimi K3 · Default」 |
| 3 | `src/ui/chat/webview.ts` `renderModelMenuModels`（2306 行） | 切模型时「新模型支持旧档位则保留」 | 切模型重置为新模型 defaultEffort（声明才带，未声明 = Default），不保留旧档位 |
| 4 | webview 模型/档位菜单行右侧 | 显示 `m.description` / `e.description` | 官方只显示 name，无 description |

根因：pi-ai 目录的 kimi-coding provider（Kimi K3 等）`reasoning` 有 `efforts`（low/high/max）但无 `defaultEffort`；而官方 ui 对该形态显示 Default 档并支持清除选择。RPC 协议两层都支持（dsh-one 的 `selectModel` 已在 reasoningEffort 为 undefined 时省略字段），改动只在 UI 层。

## 动作

- [ ] worktree 开发：webview 菜单加 Default 档（无 defaultEffort 时）、切模型改官方重置规则、`modelLabelOf` 补 Default 后缀、菜单去掉 description 显示
- [ ] 测试：`test/modelCatalog.test.ts` 补「无 defaultEffort 有 efforts → Model One Default」「efforts 为空不加后缀」
- [ ] dev-finish 自测 + 报告

## 变更记录

- 2026-09-06 用户反馈（「dsh 官方 web ui 选择模型思考强度的时候有个 default」+ 确认是 Kimi）：建条目（open/）
- 2026-09-06 用户确认目标（「我们和官方完全对齐就行了」+「不需要显示description」）：认领 → doing/
- 2026-09-06 开发完成（worktree agent/model-effort-default，自测通过 + done 标记）：webview 菜单加 Default 档（无 defaultEffort 时）/切模型重置为默认档/菜单去 description、modelLabelOf 补 Default 后缀；新增 model-picker-effort-default 视觉场景进基线；测试 591 全过；报告 test/sandbox/verify.model-effort-default.report.html（7 项 pass，待主线人工审查后合入）
