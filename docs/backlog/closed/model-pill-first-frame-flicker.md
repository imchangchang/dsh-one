# 模型 pill 打开会话时先闪「选择模型」再切到真实模型

## 背景与现象

用户反馈（2026-09-06）：每次打开会话（新开、侧栏点击、插件重载后恢复 tab）时，输入区右下角模型 pill 先显示「选择模型」占位，随后才切换为该会话的真实模型名——每开一个对话都闪一下。

## 根因（已核实）

`modelLabel` 不在会话数据流/投影里，宿主在打开会话后**额外异步拉一次**：

1. `ChatSessionController.init()`（src/server/chatSession.ts:911-944）时序：基线加载 → `ready = true; push(true)`（推第一帧，此刻 `modelLabel` 还是 undefined）→ 之后才 `refreshModels()`。
2. `refreshModels()` → `sessionModels()`（src/server/dshRpc.ts:558-582）：现代路径仍是两个 RPC（`session.models` 拿目录 + `listSessions` 拿 `modelSelection` 投影），不是同步可用数据。
3. webview（src/ui/chat/webview.ts:7182）：`state?.modelLabel ?? t('Select model')`  → `modelLabel` 缺失时渲染「选择模型」。
4. RPC 返回后 host 再 `push(true)`，pill 换成真实模型名 → 两帧可见跳变。
5. 每次打开会话都新建 controller，`modelLabel` 从 undefined 开始，故每次必闪。

**注**：model-selector-012 已修投影解析 shape（0.1.2 下 current 已能取到），本轮是「首帧时机」，两者不重叠。

## 官方 dsh web 的做法（依据 deepseek-harness 源码 packages/client/ui-model-selection）

- 当前模型 = `modelSelection` **投影**（`projected.next ?? catalog.default`），随会话数据流一次到达，不需要打开后单独 RPC（directory.ts）。
- 模型目录 = Host 级**全局单例 + 预取**：`ModelCatalogDirectory`「Loads at most one model catalog for the current Host generation」，service 构造时即 `load()`，in-flight 共享，连接重置失效、适配器/设置/凭据变化刷新（catalog.ts）。
- 等待期 pill 显示「正在加载模型…」（`trigger.loading`），「选择模型」（`trigger.fallback`）只在投影+目录都拿不到时兜底（ModelSelect.tsx）——不会出现「选择模型 → 真实模型」的误导跳变。

## 方案（对齐官方）

1. **首帧即有值**：`modelLabel` 从 SessionsStore 已缓存的 `session.list` 基线投影（`projections.values.modelSelection`，扩展启动/服务拉起 `refresh()` 已拉过）同步取，打开会话不再等打开后的 RPC；controller 或 ChatViewProvider 合成 ChatState 时读缓存。
2. **目录扩展级缓存**：`session.models`（catalog）连接期拉一次 + 失效刷新（连接重置、适配器/设置/凭据变化），不再每开一个会话拉一次。
3. **兜底文案对齐官方**：`modelLabel` 缺失且目录加载中时显示「正在加载模型…」，只有老版本服务器（无投影，legacy 路径）或拉取失败才让「选择模型」兜底。

## 涉及代码位置

- `src/server/chatSession.ts`（init/refreshModels/modelLabel 时序）
- `src/server/dshRpc.ts`（sessionModels 现代路径）
- `src/ui/sessionsStore.ts`（session.list 投影缓存读取）
- `src/ui/chatView.ts`（ChatState 合成处：modelLabel/modelCatalog 消息）
- `src/ui/chat/webview.ts`（模型 pill 占位文案 + composerSig）
- l10n bundles（「正在加载模型…」新文案键）

- 2026-09-06 记录（用户反馈，根因已定位）→ open
- 2026-09-06 认领 → doing（本轮修复：对齐官方投影取数时机 + 目录缓存 + 兜底文案）
- 2026-09-06 开发完成，自测通过（typecheck + 588 tests + build 全绿；真机 0.1.2 探针 + harness 42 场景 + 沙盒 0.1.1 legacy 回归，验收报告 test/sandbox/verify.model-pill-first-frame-flicker.report.html）→ done
- 2026-09-06 主线合入（merge 21412fa 之前：dc4d2d0 \`merge(agent): 合入 model-pill-first-frame-flicker\`），合入后复测 typecheck + 588 tests + build 全绿 → closed
