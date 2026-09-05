# 发送后消息图片附件不再显示缩略图（增量更新后占位/文件框不变）

## 背景与现象

用户反馈（2026-09-05）：发送消息之后，对话框里气泡的图片不再是缩略图，变成附件的样子（图标+文件名的文件框）。视觉验证复现：`msg-menu-user` 场景（9/4 验收通过、期望「chart.png 与 img1.png 两张红色 48px 缩略图」）现在渲染为 chart.png「…」占位方块 + img1.png 48px 图标文件框，缩略图不上屏。

## 根因

2026-09-05 08:26 合入的 dcdd1ca「消息列表增量更新替代每帧全量重建」引入：`buildFlowItems` 用 `JSON.stringify(m)` 作消息行签名，`reconcileFlow` 对签名未变的行原位保活（`same=true` 不重建）。

而 `attachmentData` / `fileThumb` 回执只写 webview 侧缓存（`attachmentCache` / `fileThumbCache`），**不改消息数据**：

- 渲染时 `messageImageThumb` 占位「…」（images → attachmentCache 无字节）；
- `fileChip` 先画图标文件框（files image:true → fileThumbCache 无字节），回执后才换缩略图。

回执 handler 照旧调 `render()`，但行签名不变 → 行被保活 → 占位/文件框永远不换真图（之前全量重建时回执后下次 render 就换）。消息内容之后发生变化（流式追加等）时行才会重建、缩略图才上屏——所以表现为「发送后图片一直停在附件样子」。

同类受影响路径：消息 `images` 占位、消息 `files` 里图片文件框、行内 `@` 图片引用提升的 chip、等待插话（steering）气泡的附件（`flowSteerSigs` 同机制）。

## 修复方向（候选）

1. **行签名并入懒加载缓存态**：`JSON.stringify(m) + '|' + <该行图片的缓存态摘要>`（attachmentCache/fileThumbCache/fileThumbRequested 状态、含文本内 @ 引用提升的图片路径）。回执后签名自然变化 → 行重建一次，之后稳定。对 user 消息与 steering 项同时生效，覆盖全部渲染路径，无需回执侧查行。
2. **回执侧失效行签名**：attachmentData/fileThumb/fileThumbFailed handler 里扫 state.messages + state.queue（含文本 @ 引用）删除对应行/steering 的签名，再 render()。零每帧开销，匹配逻辑集中在回执处，但要覆盖 images/files/@引用/steering 四处，漏一处即复发。

## 涉及代码位置

- `src/ui/chat/webview.ts`：`buildFlowItems`（行签名，~4838 行）、`reconcileFlow`（保活）、`messageImageThumb`/`fileChip`（渲染依赖缓存）、`attachmentData`/`fileThumb` handler（1273/1249 行）
- 测试：`test/ui/scenarios.js` `msg-menu-user`、`file-ref-bubble`、`attachment-uniform` 等场景覆盖缩略图上屏路径

## 变更记录

- 2026-09-05 用户反馈（消息图片不显示缩略图）→ 代码链路排查 + 视觉验证复现（msg-menu-user 占位/文件框）→ 定位 dcdd1ca 增量更新签名未含缓存态 → 建条目（open/，未改代码）
