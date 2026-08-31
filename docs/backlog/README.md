# Backlog：遗留问题与未来事项

本目录记录已知但未解决的问题、待做的改进和将来可能要做的事。每个条目一个文件，内容应包含：背景与现象、根因或现状、建议方案、涉及代码位置。条目解决后删除对应文件并更新本索引。

## 条目索引

已按优先级排序（2026-09 梳理，P0 最先做）：

| 条目 | 类型 | 优先级 | 状态 |
| --- | --- | --- | --- |
| [dsh 服务与 VSCode 生命周期解绑](dsh-survive-reload.md) | 需求（方案已讨论，5 个决策点待拍板） | P1（reload 会中断进行中的 session） | 未做 |
| [流式输出时视图跟随最新位置](stream-follow-latest.md) | 遗留问题 | P1（根因待复现确认） | 未做 |
| [子代理运行时的状态可见性](subagent-activity-visibility.md) | 遗留问题（已实测取证，2 小项） | P2（父会话等待子代理时看似空闲） | 未做 |
| [对话引用（@会话）](session-reference.md) | 需求（已调研，形态已定：显示标题） | P2 | 未做 |
| [工作区软移除](workspace-soft-remove.md) | 需求（已调研，依赖「未分组会话」条目） | P2 | 未做 |
| [数据渠道对齐官方的三个优化项](official-channel-alignment.md) | 优化（审计遗留；第 1、2 项可视作 P2；原第 4 项 clientTimeZone 已完成） | P3 | 未做 |
| [官方 UI 对齐的零散遗留项](ui-parity-leftovers.md) | 优化（7 小项，其中 2 项等 host 支持） | P3 | 未做 |
