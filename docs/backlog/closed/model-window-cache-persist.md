# 切回「之前用过的模型」仍显示「窗口未知」

记录于 2026-09-02。已核实 + 已定案；用户已确认修复（按定案方案）。

## 现象

会话有消息（contextBar 正常显示某模型 A 的比例 ％）时：切到一个新模型 B（从未观察过窗口）→「窗口未知」占位（符合设计）；**切回 A（未发新消息）→ 仍是「窗口未知」**，而设计意图是切回观察过窗口的模型应立即恢复比例。

用户另确认：完全空白的对话（无消息、无压力采样）不得显示任何 contextBar——此项已在 context-bar-blank-window-unknown 修复并合入。

## 根因（已核实）

模型→窗口学习映射 `MODEL_CONTEXT_WINDOW`（src/server/chatSession.ts）**只在内存**，且只从「会话历史尾部窗口（50 条消息）的事件扫描 + 本进程实时流」学习：

- dsh 的 `request/context` 事件只在 provider/model/contextWindow 之一变化时 append（dsh-agent-loop/lib/index.js `prepareCall` 附近：`previousContext?.provider !== ... || ...`）——同一模型的长会话往往**只有最早一条** request/context，早被尾部窗口切掉；
- 扩展进程重启/重开长会话后映射为空，`contextUsageOf` 就只能进「窗口未知」占位。
- `contextPressure` 投影是宿主按**全量**日志算的，明明带着 A 的窗口与已用量，但投影字段**不含模型归属**（dsh-token-meter usage-projection 只输出 pressureTokens/projectedTokens/contextWindow），客户端无 RPC 可查，无法用现有数据把窗口归还给 A。

## 方案（已定案，用户确认）

学习映射**持久化**到 VS Code `globalState`：任何一次观察到的 `provider/model → contextWindow` 永久留档（跨扩展进程、跨会话、跨服务重启）。learn 点收敛在 `learnModelContextWindow`（基线扫描/实时流/重放都走它），写入即持久化；启动时载入合并。切回此前用过的模型必命中映射、立即恢复比例。

边界：持久化生效前用过的旧模型第一次仍未知一次，发一条消息后永久记住。模拟/畸形持久化数据要校验过滤（纯函数解析，可单测）。

- 2026-09-02 用户确认修复（要求合理改动）。

- 2026-09-02 认领（worktree: agent/model-window-cache-persist）→ doing

- 2026-09-02 开发完成（dev-finish 自测通过：typecheck + 330 tests + build，done 标记 f7974c4）→ done。实现：src/pure/modelWindowCache.ts 持久化格式（Record<provider/model, contextWindow>，解析过滤畸形条目）+ chatSession.ts learn 时整表落盘（值未变不重写）+ extension.ts activate 里从 globalState 载入并注册写入器（key: chat.modelWindowCache，必须在 controller 附着前）；新增 modelWindowCache.test.ts 往返/畸形输入用例。无 UI 改动；人工验收点：重启扩展后切回此前用过的模型应立即恢复比例（先发一条消息让它被观察并落盘）。

- 2026-09-02 主线合入完成（merge 33d3b2f；rebase 后 typecheck/330 tests/build 复测通过，主线 dist 已重建）；用户验收后指示合入 → closed
