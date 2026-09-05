# slash 命令动态获取（commands/list），替换面板静态镜像表

## 背景与现象

面板的 slash 命令表是两份手写静态镜像（`src/ui/chat/webview.ts` SLASH_COMMANDS + `src/pure/slashCommand.ts` HOST_SLASH_COMMAND_NAMES），而宿主命令集由「dsh 版本 + 会话 preset」共同决定：0.1.2 把 command-goal 挪进 preset 组合后，kimi preset 会话的 `/goal` 报了「宿主未提供」（见 closed/slash-goal-command）。静态镜像必然滞后——官方加命令、用户切 preset 都会再变。宿主本来就有 per-session 的 `commands/list` Remote（dsh-commands，返回 name/description/input.hint/images，与已在用的 `commands/execute` 同一通道）；官方会话 UI 的 slash 菜单是 binding-fed，不是写死的。

## 方向

1. `dshRpc` 加 `listCommands`（commands/list，agentId 参数，同 executeCommand 的 client-request wire）。
2. controller 附着会话时拉一次、切 agent preset 后重拉（preset 一换命令集就变），随 state 推进 webview。
3. webview 命令表改 state 驱动；`/model` 是客户端自有命令，单独拼进列表。
4. arg hint 用返回的 `input.hint`；`HOST_SLASH_COMMAND_NAMES` 定向提示分支退役或留作拉取失败 fallback。
5. 0.1.1 兼容：沙盒 pin 的 0.1.1-rc.2 上实测 commands/list 是否可用，不可用则 fallback 静态表（保留现有六条行为）。

## 验收

- kimi preset（缺 command-goal）会话的补全列表不出现 goal；standard preset 会话出现 goal 且 `/goal ...` 正常执行。
- 切 preset 后命令列表随之变化；0.1.1 沙盒回归（六条命令补全/执行不变）。
- `/model` 行为不变。

## 变更记录

- 2026-09-05 用户确认方向（动态获取 + 顺手修 kimi preset 缺 command-goal）→ 建条目（open/）
- 2026-09-05 认领（open → doing）

## 开发结论（2026-09-05）

- 落地：dshRpc.listCommands（commands/list，同 commands/execute 的 client-request wire，agentId 参数）；ChatSessionController 附着即拉、setAgentPreset 后重拉，拉到前/失败不下发；webview 命令表改 state.slashCommands 驱动，静态表降级为 KNOWN_HOST_COMMANDS（fallback 名单 + l10n 描述覆盖层——宿主 description 仅英文，已知命令名沿用面板翻译，未知命令与 hint 用宿主原文）；/model 客户端拼接不变。HOST_SLASH_COMMAND_NAMES 保留（fallback/清单过期时宿主拒绝的定向提示仍靠它）。
- 实测：0.1.1-rc.2 有 commands/list（沙盒 probe curl，六条含 goal）；真 0.1.2-rc.1（dsh-sandbox-dsh-v012 + 临时 DSH_HOME 拷 kimi preset）standard 6 条有 goal、select → kimi 后 5 条无 goal、切 preset 清单即时生效；改后 kimi preset（补 command-goal）commands/list 恢复 6 条含 goal。
- 顺带产出：verify-driver 加 fillSlash/expectPopup 原语（补全弹窗断言，上个任务的一次性探针沉淀为仓库能力）。
- 沙盒报告：test/sandbox/verify.dynamic-slash-commands.report.html（7 项全过：3 新增 + 4 回归；kimi preset 无 goal 的 UI 差异在 0.1.1 沙盒无法构造，宿主语义层实测见 ledger coverageNote）。
- 仓库外：~/.dsh/.agent-presets/kimi/agent.cordis.yml 已补 command-goal 并对齐 0.1.2 注释（新会话生效）。
- 2026-09-05 dev-finish 通过（自测 + 报告 + done 标记）→ doing → done
