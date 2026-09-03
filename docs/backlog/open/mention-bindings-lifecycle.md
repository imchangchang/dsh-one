# mention 绑定生命周期：发送即清 + 按会话归档

## 背景与现象

@ 引用（文件/会话）的 mentionBindings 是 webview 模块级全局 Map，发送成功、失败、切会话都不清理。后果（评审确认）：
- 用户稍后附加同名不同路径文件时 fileMentionToken 因残留绑定强制生成 ` (2)` 后缀
- 无关消息字面出现同名 token（"见 @img1.png"、代码片段）时 expandMentionBindings 静默替换成旧路径——篡改原文
- 跨会话 token 唯一性相互污染；Map 无界增长

## 现状

webview.ts 的 mentionBindings / expandMentionBindings（sendCurrent 展开）；recall 历史时输入框是 canonical 长路径（与 token 体验断裂，同调）。

## 方案（待确认）

1. 发送即消费：发送后清空本次 draft 用到的绑定
2. 按会话提案：mentionBindings 与 composerDrafts/stagedPerSession 同级归档/恢复（跨会话草稿 token 可展开）
3. 展开前边界校验：token 必须作为独立词出现（前缀为行首/空白/标点），避免词中/邮箱误替换
4. recall 历史时反查绑定，把 canonical 换回显示 token

## 注意点

涉及会话 mention（既有语义）与文件 mention（新）两条路径；(2) 与 (1) 需同时保证「发送即消费」不破坏「切会话草稿恢复」。

## 变更记录

- 2026-09-08 代码评审（4 角度子代理）确认后建条目 → open
