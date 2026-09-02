# i18n：pure 模块共享文案（sessionTree/workflowRun 的状态与时间文案）

记录于 2026-09-02。i18n-webview 完成后的尾巴:pure 模块里还有少量宿主与 webview 共用的中文字面量。

## 背景与现象

- `src/pure/sessionTree.ts`:`formatRelativeTime` 的「刚刚」(143 行)、workspace 名兜底「未分组」(288 行)。
- `src/pure/workflowRun.ts`:`workflowPhaseStatusSummary` 的状态文案「运行中/已完成/失败/已取消/已中断」(60-64 行)。
- 这些纯函数被宿主侧(会话面板树、头部)与 webview 侧(消息流)同时消费,宿主用 `vscode.l10n.t`、webview 用注入的 `t()`,纯函数本身两头都不合适直接定死一种。

## 方案（待确认）

- 让 pure 函数接受文案注入(参数/依赖注入),调用方(宿主/纯函数入口)按各自机制传译文;或把返回单位从文案改为枚举,由调用方映射成文案。
- 方案细节留到开发时定,先记录。

## 前置

- `i18n-webview`(t() 基础设施,已完成)

## 涉及代码位置

- `src/pure/sessionTree.ts`(formatRelativeTime、workspace 兜底名)
- `src/pure/workflowRun.ts`(phase status 文案)
- 调用方:`src/ui/chatMessages.ts` / `src/ui/chatView.ts`(宿主)、`src/ui/chat/webview.ts`(webview)
