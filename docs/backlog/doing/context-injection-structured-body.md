# 上下文注入结构化 body（form：instructions/catalog/snapshot/notice/relay/recall）

记录于 2026-09-01。来自「能展开的都做成可展开」调研。

## 背景与现象

dsh web 的上下文注入（ContextInjectionRow）展开后按 form 渲染结构化 body；dsh-one 的上下文注入已可展开，但 body 只是一坨纯文本。

## 已核实（2026-09-02：对照 dsh web 类型与实现 + dsh-one 数据链路）

### 上游协议（dsh-llm `ContextFormed`，`@deepseek-ai/dsh-llm/lib/types/message.d.ts`）

注入上下文的 `user/message` 事件带 `source` 对象：`source.kind` 标生产者（plugin / agent-instructions / session-reference…），`source.form` 声明信息形态，枚举 6 种，且**每种强制带专属字段**（discriminated union）：

| form | 含义 | 结构字段 |
|---|---|---|
| `instructions` | 工作区指令文件 | `changes: [{path, action: set/replace/remove, digest}]`、`baseline` |
| `catalog` | 插件能力目录 | `entries: [{name, description}]`、`update` |
| `snapshot` | 当前状态快照 | `sections: [{name, text}]` |
| `notice` | 一次性事件 | `summary`（显示在折叠行，不展开可读） |
| `relay` | 其他 agent 转发来的消息 | `senderSessionId` |
| `recall` | 跨会话召回 | `references: [{label, retainedMessages, omittedMessages, truncated}]` |

注意：`ContextFormed` 挂在 `source.kind === 'plugin'` 分支上（`{kind:'plugin', plugin} & ContextFormed`）；无 form 的上下文（如其他扩展的 kind）不算声明，属正常形态。

### dsh web 渲染（`ContextInjectionRow` + `contextBody`，dsh-client-ui-conversation）

折叠头：「上下文注入/上下文召回（recall 分支）」+ 生产者名（`contextProvenance` 从 source 投影 label）+ notice 的 summary。展开 body 按 form 选组件：

- `instructions` → 文件变更列表（path + loaded/added/updated/removed 动作）+ 模型正文；source 的 changes 读不完整个退回 opaque（防「自信但不完整」的列表，all-or-nothing）
- `catalog` → entries 列表（code 名 + 描述），超出 `MAX_ENTRIES` 显示「还有 N 条」，`update: true` 时顶部加「已替换」提示 + 正文里非目录部分仍展示
- `snapshot` → 分段 dl（name + boundedText），顶部「本快照取代先前版本」说明
- `notice` → 折叠行 summary + 模型正文
- `relay` →「来自会话 {sessionId}」一行 + 正文
- `recall` → 每个召回会话「label · 保留 X/省略 Y」+ truncated 标记 + 正文——完整性是读者首先需要的事实
- form 未知或字段不可读 → 退化 opaque（原始正文 + source 字段）

body 容器：`max-height: 141px`、代码字体、可滚动（截断）。

### dsh-one 现状（2026-09-02 核实）

- 折叠（`src/pure/conversation.ts:509` `user/message` 分支）：只取 `sourceKind = data.source.kind`，存成 `ChatUserMessage.context`；唯一额外消费是 `source.references`（session-reference 时回挂到前一条用户消息的 `references`），其他结构化字段全丢。
- 渲染（`src/ui/chat/webview.ts` `renderMessage` 的 `m.context` 分支，~3306-3320）：summary = 图标 + `contextLabel(kind)`（工作区指令/运行时上下文/跨会话召回/上下文注入）+「（已随消息注入）」，body 是 `m.text` 原文。
- **数据链路无裁剪**：`src/server/muxEvents.ts` 对 `/api/events.mux` 的 `payload` 原样 JSON 透传，dsh-one 拿到的 `source` 就是完整对象（`source.references`、`source.kind`、checkpoint 的 `source.plugin` 已证明可读）。

**纠偏（2026-09-02）**：原条目「依赖 host 补 source 解析」不成立——无需上游 dsh 改动，结构化字段已全在 dsh-one 手上。

## 方案（2026-09-02 更新）

仓库内三步，无上游依赖：

1. fold（`src/pure/conversation.ts` `user/message` 分支）：从 `data.source` 解析 form + 各 form 字段（参照 dsh web 的 all-or-nothing 校验），投影进 `ChatUserMessage`；`context` 字段从 string kind 扩展为结构化对象（保留 kind 用于 label 与旧数据兼容）。
2. `src/pure/chatContract.ts`：`ChatUserMessage` 加 form 数据字段（discriminated union 或宽松对象均可，需注意流式重建的 JSON 序列化）。
3. webview（`src/ui/chat/webview.ts`）：按 form 渲染 6 种 body + 截断（141px 滚动容器）+ form 未知退化 opaque；label 可顺带对齐 `contextProvenance`（recall 分支换 ReferenceIcon）。

## 涉及代码位置

- `src/pure/conversation.ts`（user/message 分支，source 解析）
- `src/pure/chatContract.ts`（ChatUserMessage 字段）
- `src/ui/chat/webview.ts`（renderMessage m.context 分支 + contextLabel）
- 参考（上游，只读不改）：`@deepseek-ai/dsh-llm` `ContextFormed`、`dsh-client-ui-conversation` `ContextInjectionRow`/`contextBody`、`dsh-client-runtime` `contextForm`/`contextProvenance`

## 变更记录

- 2026-09-01 记录（「能展开的都做成可展开」调研）→ open
- 2026-09-01 评审确认：做（用户标注）
- 2026-09-02 核实更新：对照上游类型/实现确认 6 种 form 协议与字段；确认 dsh-one 数据链路完整透传，纠掉「依赖 host 支持」；方案改为仓库内三步

- 2026-09-02 认领（Sprint 2 节点，worktree: agent/context-injection-structured-body）→ doing
