# 上下文注入结构化 body（text/files/json/entries/sections）

记录于 2026-09-01。来自「能展开的都做成可展开」调研。

## 背景与现象

dsh web 的上下文注入（ContextInjectionRow）展开后按 form 渲染结构化 body（text/files/json/entries/sections + 截断）；dsh-one 的上下文注入已可展开但 body 较简单。

## 现状

- dsh-one 上下文注入已可展开；结构化 body 数据部分可用，完整渲染需 host 补 source 解析。

## 方案

对照 dsh web ContextInjectionRow，渲染结构化 body（按 form：text/files/json/entries/sections + 截断）。**依赖 host 补 source 解析**——dsh-one 侧数据部分可用，但完整结构化需要上游（host）支持，标注为待 host 支持。

## 涉及代码位置

- `src/ui/chat/webview.ts`（上下文注入渲染）
- host 侧（source 解析，上游支持）
