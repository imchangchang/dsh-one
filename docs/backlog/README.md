# Backlog：遗留问题与未来事项

本目录记录已知但未解决的问题、待做的改进和将来可能要做的事。每个条目一个文件，内容应包含：背景与现象、根因或现状、建议方案、涉及代码位置。条目解决后删除对应文件并更新本索引。

## 条目索引

已按优先级排序（2026-09 梳理，P0 最先做）：

| 条目 | 类型 | 优先级 | 状态 |
| --- | --- | --- | --- |
| [dsh 服务与 VSCode 生命周期解绑](dsh-survive-reload.md) | 需求（方案已讨论，5 个决策点待拍板） | P1（reload 会中断进行中的 session） | 未做 |
| [流式输出时视图跟随最新位置](stream-follow-latest.md) | 遗留问题 | P1（根因待复现确认） | 未做 |
| [未分组会话在面板不可见](ungrouped-sessions.md) | 需求（已调研） | P1 | 未做 |
| [Esc / Ctrl+C 打断当前 turn](esc-interrupt-turn.md) | 需求（决策已定） | P2 | 未做 |
| [对话引用（@会话）](session-reference.md) | 需求（已调研，形态已定：显示标题） | P2 | 未做 |
| [会话处理完成后不自动标未读](auto-unread-on-finish.md) | 需求（dsh web 有等价的「已完成」自动标记，属对齐缺口） | P2 | 未做 |
| [工作区软移除](workspace-soft-remove.md) | 需求（已调研，依赖「未分组会话」条目） | P2 | 未做 |
| [数据渠道对齐官方的四个优化项](official-channel-alignment.md) | 优化（审计遗留；第 1、2 项可视作 P2） | P3 | 未做 |
| [官方 UI 对齐的零散遗留项](ui-parity-leftovers.md) | 优化（7 小项，其中 2 项等 host 支持） | P3 | 未做 |
| [无会话 workspace 组头图标显示为展开态](empty-workspace-expanded-icon.md) | 界面问题（已核实，根因明确） | P3 | 未做 |
| [会话面板增加「折叠所有工作区」按钮](collapse-all-workspaces.md) | 需求（方案已列） | P3 | 未做 |
