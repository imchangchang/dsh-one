# webview 框架迁移评估（React/Preact）——本次前端问题归因分析存档

## 背景与归因（2026-09-06 讨论的核实结论，事实均有官方 bundle 证据）

用户观察：前端交互反复出「别处早解决了」的问题（输入跳动、输入中断、
排队消息丢失……）。归因核实后，corner case 分三层，框架只能治一层：

### 三层模型

1. **结构选型层（框架治不了）**：composer 在滚动容器外做 flex 兄弟，变高压
   缩消息区 → 整类「塌缩 clamp→补偿」抖动（composer-input-jitter-pinned-scroll）。
   官方用 React 也照样手写滚动跟随状态机（`dsh-client-ui-chat/lib/client.js`
   的 `atBottomRef` + 25px 阈值 + scroll 采样），没踩坑是因为 composer 在滚动
   容器内 sticky——**布局设计，不是框架**。
2. **自造交互复杂度层（框架半治）**：透明 textarea + 叠加层画 @ token。
   官方用 Lexical 编辑器库解决（token 是原生节点）。治法是编辑器库，
   框架只是配套。
3. **渲染对账层（框架直接免费）**：`dcdd1ca` 手写了迷你 React——
   `reconcileFlow` 增量对账 + 行身份保活 + 锚点重挂 + dispose 生命周期。
   `composer-ghost-after-send`、`composer-draft-lost-on-pending`、
   `input-keepalive-coverage-gaps`（14 处输入点 review 出 5 处 IME 中断缺口）
   全是手写 diff 引擎的边界 case。React/Preact 的声明式 reconcile +
   稳定 key 让「数据刷新不碰正在输入的 DOM」成为默认行为，这类 bug 整类消失。
   **这是框架唯一的硬收益。**

### 官方栈核实事实（bundle 实证，非猜）

- React 18.3.1 + react-dom；状态管理是自研 `dsh-client-store`（cordis 生态），
  不是 @preact/signals
- composer = Lexical（`lexical@^0.49.0` 五包），@ token 为
  `ReferenceChipNode`/`TextRefNode` 原生节点
- 聊天列表**无虚拟化**；`@tanstack/virtual-core` 仅 `dsh-client-ui-trajectory` 用
- 滚动跟随无库，手写（同上）
- composer 无 `style.height` JS 测量（conversation bundle 0 次）
- 官方前端体量：37 个 `dsh-client-ui-*` 包 + cordis 框架 + React 全套——
  是完整产品前端；我们是插件壳（deps 只有 marked + dompurify，7k 行手写 DOM）

### 不是框架问题的部分

- 排队消息丢失（queue-lost-after-session-switch）：宿主数据流层
  （共享 control 流 baseline 只发一次，晚订阅者收不到）——协议订阅语义问题，
  框架管不着，修法是流层快照缓存 + 重放。
- webview × VS Code 宿主集成、dsh 协议、markdown 渲染：无现成库，
  官方也是自研。

## 迁移收益与代价（诚实版）

- **收益**：渲染一致性类 bug（输入中断/草稿丢失/鬼影）整类消失；
  弹窗/浮层可用 floating-ui 等成熟库；7k 行手写 DOM 的可维护性已到极限
  （self-lock→momentum→drift→caret-sync 的补丁链是规模症状）。
- **代价**：重写约 7k 行 webview + 宿主集成；历史修复逻辑全部重验；
  scenarios.js 全部基线场景 DOM 结构变化、回归面重跑；迁移期双轨成本。
- **框架不解决的**：滚动物理（惯性/clamp/跟随判定，官方 React 也手写）、
  结构选型、宿主协议层。

## 建议时机与形态

- **现在不迁**。先做 composer-sticky-in-scroller-layout（结构层）+
  composer-lexical-eval（编辑器层）。这两步做完后，看 backlog 里
  「增量渲染对账类」条目的增速——那是第三层的可观测指标，增速仍快再迁。
- 真要迁：webview 场景 **Preact**（~10KB，API 兼容 React）比 React
  （~140KB）更合适；只迁 chat webview，sessionsWebview 视情况。
- 本条目是评估存档，不是开发任务；确认迁移时再拆条目。

## 变更记录

- 2026-09-06 前端问题归因讨论（官方 bundle 核实：React 18 + Lexical +
  自研 store + 无虚拟列表 + 滚动手写）→ 三层归因模型成型 → 作为评估
  存档条目 → open
