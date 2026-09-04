# 中文界面下头部后台任务 chip 显示英文（jobsChipLabel 漏传 t）

记录于 2026-09-03。用户反馈：中文界面下，会话头部「N 个后台任务运行中」chip 显示英文，如「2 background jobs running」。

## 根因（已核实）

`src/ui/chat/webview.ts:2658`：

```ts
const jobsLabel = state.backgroundJobs ? jobsChipLabel(state.backgroundJobs) : null
```

`jobsChipLabel`（src/pure/activityTree.ts:52）的第二参数 `t` 缺省为 `enFallback`（src/pure/sessionTree.ts:151，永远返回英文模板）。调用处没传 webview 的 `t`，于是任何 locale 下 chip 文案都是英文。

译文本身不缺：`l10n/bundle.l10n.zh-cn.json` 里 `"{0} background jobs running"` → `"{0} 个后台任务运行中"`、`"{0} background jobs"` → `"{0} 个后台任务"` 都在；同文件其它调用点（`jobStatusLabel` :2071、`formatJobDuration` :2078/:2081）都正确传了 `t`，只有 chip label 这一处漏了。chip 的悬停 `chip.title = t('Background jobs')`（:2713）正常。

## 建议方案

一行改：:2658 改为 `jobsChipLabel(state.backgroundJobs, t)`。

顺带注意：`scripts/check-i18n.sh` 的存量完整性检查只查 `t()`/`vscode.l10n.t()` 的 key 是否进 bundle，查不出「该传 t 没传、走 enFallback 默认参数」这类漏网，本条只能靠测试或人工发现。

另：job 下拉行里的 `job.detail`（如 "exit code: 0"）是 host 经 session/jobs 帧给的英文原文（activityTree.ts:20 注明优先展示），不在本条目范围。

## 涉及代码位置

- `src/ui/chat/webview.ts` — :2658 调用处
- `src/pure/activityTree.ts` — `jobsChipLabel`（:52，本身无需改）

## 变更记录

- 2026-09-03 用户反馈中文界面后台运行 job 没翻译 → 核实根因（webview.ts:2658 调 jobsChipLabel 未传 t，走 enFallback；zh bundle 译文存在）→ 记入 open/（未开始修改）。

- 2026-09-04 认领（open → doing）：按条目方案实施——webview.ts 的 jobsChipLabel 调用补传 t（实际行号 :2771，条目中 :2658 已漂移），中英文沙盒验证。

- 2026-09-04 开发完成（doing → done，agent/i18n-polish）：webview.ts:2771（条目原文 :2658 已漂移）jobsChipLabel 补传 t；自测全绿（typecheck + 386 tests + build，check-i18n.sh 通过）；测试报告 test/sandbox/verify.i18n-polish.report.html——沙盒 code-server 无 zh nls 切不出中文界面（argv.json/--locale/浏览器语言均实测无效），zh 项用 webview harness 注入真实 zh bundle 验证，并 A/B 对照修复前同场景显示英文「1 background jobs running」；另注：check-i18n.sh 查不出漏传 t（只查 key 是否入 bundle），本条只能靠测试/人工发现。
