# markdown 代码块折叠 + 复制

记录于 2026-09-01。来自「能展开的都做成可展开」调研。

## 背景与现象

dsh web 的 markdown 代码块有行数折叠（「展开其余 N 行」）和复制按钮；dsh-one 的 markdown 代码块不可折叠、无复制。

## 现状

代码块 text 全文已在折叠模型里（webview.ts 渲染 markdown），纯 webview 改动即可。

## 方案

代码块超 N 行时折叠（显示「展开其余 N 行」/折叠态摘要），加复制按钮。纯 webview.ts 改动。

## 涉及代码位置

- `src/ui/chat/webview.ts`（markdown 代码块渲染）
