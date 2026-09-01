# JSON 输出 JsonTree 逐节点展开

记录于 2026-09-01。

## 背景与现象

dsh web 展示 JSON 数据时用 JsonTree：对象/数组渲染成树形结构、节点前有展开箭头、逐级点开看嵌套内容，而不是平铺一大段文本。用于工具输出等看 JSON 的场景。dsh-one 的 JSON 输出是纯文本。

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
- 2026-09-01 评审确认：做（用户标注）

- 2026-09-01 认领（worktree: agent/json-output-tree）→ doing
- 2026-09-01 完成开发（→ done）：工具输出（block.output）检测为 JSON 对象/数组时
  渲染 JsonTree（对齐 dsh web 形态：箭头 toggle、逐级缩进、token 配色、根展开/嵌套收起
  默认策略）；新增 src/pure/jsonTree.ts（保守检测 + 平铺行模型 + 默认展开）+ 15 单测；
  webview 渲染 + chatView STYLE + gen-ui-harness 抽出；scenarios 加 json-output /
  json-output-expand 两个 dark 视觉场景（后者模拟点箭头展开）。非 JSON 输出保持纯文本，
  现有 conversation/tool 场景无回归。自测 typecheck/test/build 全绿。
- 2026-09-01 补充（用户拍板：五项决策除「官方复制按钮」外保持现实现）：JSON 树右上角加
  「复制」按钮——复制整棵树 2 空格 pretty JSON（copyPrettyJson，新增
  src/pure/jsonTree.ts 的 jsonTreeCopyText + 2 单测）；成功按钮短暂「已复制」（1s 还原）、
  失败改 title，反馈对齐既有 code-block-copy（md-code-copy）；样式沿用 json-tree 配色 +
  md-code-copy 的克制按钮。scenarios 加 json-output-copy 场景（monkeypatch clipboard 断言
  复制内容 + 按钮反馈）。自测 typecheck/test/build 全绿（240 测试）。
