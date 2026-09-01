# JSON 输出 JsonTree 逐节点展开

记录于 2026-09-01。

## 背景与现象

dsh web 展示 JSON 数据时用 JsonTree：对象/数组渲染成树形结构、节点前有展开箭头、逐级点开看嵌套内容，而不是平铺一大段文本。用于工具输出、轨迹面板等看 JSON 的场景。dsh-one 的 JSON 输出是纯文本。

## 现状

- dsh-one 工具输出是纯文本渲染（fold 时 4000 字符硬截断，见前置 `output-full-text-restore`）。
- 前置：**需要先解决输出全文可恢复**——截断问题解决后才能拿到完整 JSON 建树。

## 方案

JSON 输出（工具输出等）用 JsonTree 逐节点展开：检测输出为 JSON 时渲染成树形结构（节点展开/收起箭头、逐级点开）。对齐 dsh web JsonTree。

## 前置

- `output-full-text-restore`（折叠层全文恢复）

## 涉及代码位置

- `src/ui/chat/webview.ts`（输出渲染，JSON 检测 + JsonTree）
- 前置：`src/pure/conversation.ts`（输出全文恢复）
