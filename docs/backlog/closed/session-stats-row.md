# 会话级统计行：输入框下方对齐官方（轮数/步数/时长/缓存）

## 背景与现象

0.1.2 差异对账（官方 dsh web vs dsh-one 面板，2026-09-05）：官方会话视图**输入框下方**有一行会话级统计：`109 轮 · 458 步 · LLM 49 分 35 秒 · 工具调用 223 分 46 秒 · 首 token 平均 1.9 秒 · 117 tok/s · 缓存命中 99%…`（截图 verify）。我们面板只有消息行级计时（turn 级别数），输入框下方无此会话统计行。

## 现状（dsh-one）

- 已有单消息/单 turn 计时行（message-turn-timing-metrics 已闭环：用时 · 首 token · tok/s）+ 阶段 3 的 token 用量明细药丸。
- 会话级聚合（总轮数/步数/LLM 累计时长/工具累计时长/平均首 token/tok/s/缓存命中）未在 UI 展示——数据面部分存在（sessionStats/tokenUsage 投影：dsh 0.1.2 有 sessionStats/contextPressure/tokenUsage 投影，见 model-selector-012 会话 list 输出）。

## 方案（实现时细化）

1. 输入框下方（或输入行内）一行统计（对齐官方字段与格式；数据来源 `sessionStats`/`tokenUsage` 投影（0.1.2）——先核实投影字段覆盖率，缺的字段推断/缺省）。
2. 展示规范：次要信息、小字号灰显；随会话切换刷新；若字段不全显示可得的（缺省注明）。
3. 布局：与现有权限/模型 pill 行共存（官方同区域也是权限+模型 pill + 统计行）。

## 验收

- 会话视图输入框下方显示统计行，字段与官方对齐（可得字段）；切换会话刷新；0.1.1 路径（如服务端无 sessionStats 投影则降级不显示/显示可得）。
- harness 快照 + 截图；真 dsh（本机 0.1.2）沙盒或人工开窗。

## 变更记录

- 2026-09-05 差异对账发现（官方输入框下方统计行）→ 建条目（open/）

- 2026-09-05 认领（open → doing，worktree: agent/session-stats-row）。

- 2026-09-05 开发完成（worktree: agent/session-stats-row，commits 6d982ce+ef58b96+42bc341+7f32cd9+c4dda68，done 标记 c4dda68）。落地：formatStatsLine 增 tokenUsage 参数补「缓存命中 X% · 输入/输出 tok」组（官方 StatsLine 同构）；时长格式化本地化（zh 2分42秒/45.2秒，原硬编码英文单位）；组间分隔符改 ASCII「 | 」；文案键对齐官方（TTFT avg/Tool call/Cache hit/Input…Output）；缓存命中与紧凑 token 助手从 webview 上移 pure 合并一份；chatSession 折叠 tokenUsage 投影（基线+live 任一落地即重算统计行），0.1.1 无 tokenUsage 时行照常显示 sessionStats 可得字段。自测：typecheck/523 tests/build + check-i18n 全绿。报告 test/sandbox/verify.session-stats-row.report.html：F-01 harness 官方全字段行+context 环 pass、F-02 沙盒真 dsh 0.1.2-rc.1（容器内升级）统计行折叠 pass、F-03 本机 0.1.2-rc.1 真实投影字段覆盖（sessionStats 8 字段+tokenUsage 4 桶，真实值出 EN/ZH 全行含缓存命中 99%）pass、F-04 无投影整行隐藏 pass、R-01 0.1.1-rc.2 沙盒回归 pass（实测 0.1.1 也有 sessionStats——条目原「无投影不显示」假设不成立，实际降级=显示可得字段）、R-02/R-03 conversation/turn-usage-detail webview 回归 pass。→ done
- 2026-09-05 主线合入后人工确认（目标验收通过）→ closed
