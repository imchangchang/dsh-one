# 会话打不开时界面无提示：点击无反馈 / 仅「本轮运行失败」气泡

记录于 2026-09-05。用户会话日志损坏（详见「已核实」）导致后端读取失败，GUI 点击该会话**没有明确可读的失败提示**——用户报告点击后完全没有内容/tab 出来，很困惑；另一场景（子会话引用父会话）只显示「本轮运行失败」气泡。未开始修改。**优先级：中**（数据真实发生且用户完全摸不着头脑；但一次性的，修复价值在于防下次）。归属待确认：疑似 dsh harness 的 web 前端（下游 npm 包），不一定是 dsh-one 本体。

## 背景与现象

- 后端拒绝读损坏日志：`failed to inspect session "...": corrupt session log: seq gap in committed region at line 26045 (expected 331845, got 331843)`；子会话场景包一层 `failed to read referenced session:`。
- 界面侧：点击损坏会话无任何可读提示（用户描述「完全没有 tab 出来」）；子会话引用失败只出现「本轮运行失败」错误气泡。
- 本次损坏本身已手工修复（见下），数据未丢失。

## 已核实（根因 / 现状）

- **损坏根因（上游 dsh bug，已核实）**：turn 被中断时先写入 `step/end`+`turn/end`（如 seq 331843/331844）；恢复生成后，重跑 run 的前两条事件**复用同样的 seq** 追加在收尾事件之后，appender 没有截断——日志出现重复 seq，其后所有事件整体偏移 2。`@deepseek-ai/dsh-session-persistence-jsonl` 的 `SessionLogScanner.consumeEventLine`（node_modules/.../lib/index.js:336）对 seq 与累积计数不匹配一律抛 `corrupt session log`，严格拒读，无恢复路径。
- **前端提示缺失位置未定位**：dsh web 前端是打包后的 client bundle（dsh-client-ui-session / workspace / conversation），按 `open` 调用链（workspace 树 → `sessions.open`）检索过，没找到失败时的用户可见呈现路径；「本轮运行失败」气泡由 dsh-client-ui-chat 渲染（`message.turnError`），仅覆盖运行期错误，不覆盖「打开读取失败」。
- **本次修复**（可复用）：解档 → 删除中断收尾的 2 条过期事件 → 按「首帧=header、次帧=事件」规范重压。验证：371604 事件、seq 0..371603 连续无重复，真实 API `session/page` 读取成功。脚本在 `/tmp/dsh-session-repair/`（临时，未入库）。

## 建议方案（未拍板）

1. **打开失败必给提示**：点击/打开会话时后端读取失败 → 在会话视图（或 toast）显示错误码 + 摘要（如 `corrupt session log: ...`），并给出可操作建议（联系 dsh 升级/反馈）。
2. **上游 dsh 修复**：中断恢复时 appender 应截断/回滚已写但被重放的收尾事件（对齐 in-memory rollback 语义），而不是继续追加。
3. 顺带：schema 校验失败与 seq 冲突可区分提示——「日志损坏」vs「harness 不可读（升级）」已由 SessionFormatUnsupportedError 区分，前端应透传该语义。

## 验收方式

- 人工/截图：打开一个已知损坏会话（构造或保留副本）应出现明确错误提示而非空白。
- 回归：正常会话打开行为不变。

## 变更记录

- 2026-09-05 session-open-failure-hint 认领（open → doing）。

- 2026-09-05 session-open-failure-hint 开发完成（doing → done，附实现/自测/报告结论）：
  - 实现：ChatState.openError 透传后端打开失败原因；ChatSessionController 在历史基线失败
    （legacy session.history / 0.1.2 follow 快照落地前）记录并在基线成功后清除；webview
    整页渲染错误提示（标题 + 建议 + 原因行），侧栏再点一次该会话重建 controller 重试。
  - 覆盖：打开失败的主要路径（日志读取失败/RPC 错误/会话不存在与损坏）；文案中英 l10n。
  - 自测：typecheck + test(537 过) + build 通过；test/ui 场景 session-open-failure 与
    -not-found 渲染核对通过（F-01/F-02），既有 UI 回归 10 项通过；报告
    test/sandbox/verify.session-open-failure-hint.report.html（12 项全 pass）。
  - 注明：宿主全链路（真实损坏日志）未在真 dsh 桌面环境跑通，属 dev-ui-test 人工验收范畴。
