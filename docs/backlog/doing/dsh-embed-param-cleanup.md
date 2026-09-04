# 清理 dsh_embed=vscode 参数（官方从未消费）

## 背景

`DSH One: Open dsh Page` 的 iframe 嵌官方 dsh web UI 时，URL 拼 `?dsh_embed=vscode`（`src/ui/webview.ts:118`），初衷是让官方在 iframe 里隐藏侧栏（`docs/architecture.md:114`）。但官方从未消费该参数：0.1.1-rc.2 未消费（architecture.md 自述），0.1.2-rc.1 完整源码 grep `packages/client/` + `apps/web/` 零命中。当前加了等于没加，iframe 显示完整官方 UI（含侧栏）。主聊天前端（侧栏会话列表 + chat 面板）全自研，与本参数无关。

## 方案（已与主 session 拍板：删）

1. `src/ui/webview.ts:118` 删除 `target.searchParams.set('dsh_embed', 'vscode')` 一行（iframe 行为零变化）。
2. `docs/release-checklist.md:28` 删除验收项「`dsh_embed=vscode` 生效：iframe 里官方 UI 的侧栏隐藏」——官方不支持，是永远无法真正通过的死项。
3. `docs/architecture.md:114`、`docs/roadmap.md:66/74` 更新"预留参数"相关表述：改为"官方未提供嵌入隐藏侧栏的能力，已删除预留参数；如需跟进，见上游 issue/PR 路线（roadmap 的融合增强项）"。

不需要新增别的行为。将来官方真支持嵌入隐藏，通过 roadmap 里"需给上游 dsh 提 issue/PR"的增强项跟进，而非预埋无效参数。

## 变更记录

- 2026-09-08 调研确认：官方 0.1.2-rc.1 不消费 dsh_embed；主 session 拍板清理 → open

- 2026-09-04 认领（worktree: agent/dsh-embed-cleanup）→ doing
