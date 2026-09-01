# chat markdown 渲染补全（非表格的 GFM 元素缺样式）

记录于 2026-09-01。用户在观察 dsh-one 的「各环节分工总览」表格时提出：chat 里所有 markdown 格式都应按 markdown 样式渲染，除表格外需排查是否还有其他遗漏导致观感不一致。

## 现象

`src/ui/chatView.ts` 的 `.md` 样式**只覆盖了 `pre`（代码块）与 `code`（行内代码）**，其余 GFM 块级/行内元素全靠浏览器默认值，在深色 webview 里观感散、不统一。表格是最明显的（无边框、无网格线、表头居中对齐但内容左对齐、列间距过大），但并非唯一。

## 现状 / 遗漏清单

`.md` 下缺失样式的 GFM 元素（marked GFM + DOMPurify 默认都能解析、能保留，落到浏览器默认样式）：

- `table` / `thead` / `tbody` / `tr` / `th` / `td`：无 `border-collapse`、无单元格边框/内边距、表头无底色、无横向滚动。
- `h1`–`h6`：无分级字号/字重/间距，标题与正文观感不匹配。
- `ul` / `ol` / `li`：无缩进与间距控制（部分依赖浏览器默认，但不稳）。
- `blockquote`：浏览器默认 40px 左缩进、无主题边框。
- `a`（链接）：未用 `--vscode-textLink-foreground`，主题下颜色不对。
- `img`：无 `max-width: 100%`，宽图可能溢出。
- `hr`：无主题化分隔线。
- 任务清单（GFM task list）：`input[type=checkbox]` / `.task-list-item` 无样式。

## 涉及代码位置

- `src/ui/chatView.ts`（`.md` 样式段，约 344 行起）

## 备注

- 改动主落在 `src/ui/chatView.ts` `STYLE` 的 `.md` 段，追加一套 GFM 子元素样式，颜色用 `--vscode-*` 变量保持一致。
- 这是 UI 类改动，合入前须人工在 dev-ui-test 窗口做视觉验收（headless 代理起不了 GUI）。
- 2026-09-01 认领（worktree: agent/chat-markdown-render）→ doing
