# 轨迹视图与工具详情面板缺失（对齐 dsh web）

记录于 2026-09-01。对比 dsh web 聊天面板与 dsh-one 时发现（调研见 `docs/dsh-web-expandable-ui-research.md` 第三节 P2，此处补整屏视图与详情面板）。

## 现象

dsh web 有完整的调用链查看设施，dsh-one 完全没有：

1. **头部 View Tabs**（chat / trajectory 两个视图 tab，`role=tablist`）：`dsh-client-ui-conversation` `ConversationSessionHeader`（lib/client.js:7394-7405），trajectory 包注册 `conversation.view` id=`trajectory`（:7346）。dsh-one 头部（webview.ts:1639-1700）无任何 tab。
2. **整屏 Trajectory 视图**：工具栏（Duration 切换 + Turns/Calls 折叠 + 搜索框）+ 左右分栏 + 详情 tabs（Summary/Preview/Raw/Source/Payload）——`dsh-client-ui-trajectory` `TrajectoryToolbar`（:5331）。
3. **右侧工具详情面板 `DetailsPanel`**：`conversation.details.tool` slot（:7486-7556），header + 关闭 + 「详情/输入」CodeBlock + 「输出」。dsh-one 选工具行无详情侧板；tool 卡尾部也无 Inspect 按钮（web ToolRow 有）。

## 现状

- dsh-one 无 trajectory/session 查询数据链路（chatContract 无对应事件），整块是「视图 + 数据 + 路由」新功能，不是 UI 补丁。
- `docs/dsh-web-expandable-ui-research.md` 已把「轨迹面板 + Inspect」列为 P2 远期；本条目补齐视图 tab / 工具栏 / 详情面板三件事。

## 涉及代码位置

- dsh web：`dsh-client-ui-trajectory`、`dsh-client-ui-conversation`（ConversationSessionHeader / DetailsPanel）
- dsh-one：`src/ui/chat/webview.ts`（头部 render 与 renderTool，若做则需先加数据链路）

## 变更记录

- 2026-09-01 记录 → open
