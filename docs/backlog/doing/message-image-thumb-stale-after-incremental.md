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
<<<<<<<< HEAD:docs/backlog/done/message-image-thumb-stale-after-incremental.md
- 2026-09-06 认领（worktree: agent/message-image-thumb-stale）→ doing；再次分析核实：根因确认（webview.ts:5199 行签名 `JSON.stringify(m)`，attachmentData:1404/fileThumb:1375/fileThumbFailed:1379 回执只写 attachmentCache/fileThumbCache/fileThumbRequested 后 render()，不改消息数据）；影响路径全部核实：消息 images 占位（messageImageThumb:4315，attachmentCache 未命中）、消息 files 图片文件框（fileChip:4359，fileThumbCache 未命中）、行内 @ 引用提升（renderMessage:4886 mergedAttachments(inlineFileRefs, m.files) 同源）、steering 气泡（renderSteeringItem:4281 同款渲染，flowSteerSigs:5251 同机制）；composer 挂起附件（pendingFileChip:6897）走 previewData 不依赖 fileThumbCache 懒路径，不属本条目范围
- 2026-09-10 开发完成（worktree: agent/message-image-thumb-stale）：行签名并入懒加载缓存态（lazyThumbSig：attachmentCache/fileThumbCache 命中态逐项编码，输入与 inlineFileRefs/mergedAttachments 渲染路径同源），buildFlowItems 对 user 非 context 消息与 steering 项签名追加缓存态 → 回执后该行重建一次换真图，缓存稳定后签名稳定行保活；fileThumbFailed 不改渲染输出不触发重建。验收：thumb-ack-after-incremental 场景（no-ack/acked/re-snap-stable 三态 + ACK-REBUILD-ONCE:OK 探针）进基线；R：msg-menu-user/attachment-uniform/file-ref-bubble/steering-pending + 沙盒 mock-llm 回显全 pass；mutation-driver AB 对照（改前 vs 改后 14 帧流式泵入逐帧变更量/finalTextHash 完全一致，流式保活零回归）
- 2026-09-10 dev-finish 通过（typecheck + 614 tests + build，done tag 37e9486）→ doing → done（worktree: agent/message-image-thumb-stale）；合入由主线执行
========
- 2026-09-06 认领（worktree: agent/message-image-thumb-stale）→ doing；核实根因与影响路径（见下）
>>>>>>>> 19bba4d (backlog: 认领 message-image-thumb-stale-after-incremental（open → doing）):docs/backlog/doing/message-image-thumb-stale-after-incremental.md
