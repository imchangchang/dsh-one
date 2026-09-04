# mention 绑定生命周期：按会话归档 + 边界校验 + recall 反查

## 背景与现象

@ 引用（文件/会话）的 mentionBindings 是 webview 模块级全局 Map，发送成功、失败、切会话都不清理。后果（评审确认）：
- 用户稍后附加同名不同路径文件时 fileMentionToken 因残留绑定强制生成 ` (2)` 后缀
- 无关消息字面出现同名 token（"见 @img1.png"、代码片段）时 expandMentionBindings 静默替换成旧路径——篡改原文
- 跨会话 token 唯一性相互污染；Map 无界增长

## 现状

webview.ts 的 mentionBindings / expandMentionBindings（sendCurrent 展开）；recall 历史时输入框是 canonical 长路径（与 token 体验断裂，同调）。

## 方案（已拍板 2026-09-04：按会话归档）

1. **按会话归档/恢复**：mentionBindings 与 composerDrafts/stagedPerSession 同级，按 session 存储（新会话空 Map、切会话恢复、发送成功/失败不强制清空——绑定随草稿生命周期走）。
2. **展开前边界校验**：token 必须作为独立词出现（复用 paste-token-parsing-boundaries 的统一扫描起点的边界/终止规则），避免词中/邮箱误替换。
3. **recall 反查**：召回历史消息时反查绑定，把 canonical 长路径换回显示短 token。

**不做**：发送即消费（否决；与按会话归档互斥，且发送后草稿仍可能召回）。

## 依赖

**前置：paste-token-parsing-boundaries**（本条目先拍板先行，其统一 @token 扫描纯函数是本条目边界校验的实现基础；本条目排在它之后开发）。

## 注意点

## 变更记录

- 2026-09-08 开发完成（worktree mention-bindings）：① mentionBindings 按会话归档/恢复（webview 模块级 → mentionBindingsPerSession，切换时归档旧会话、新会话空 Map、发送成功/失败不清空——绑定随草稿生命周期走），消除跨会话同名的强制 ` (2)` 后缀与 token 唯一性污染；② 展开前边界校验复用前置 tokenScan（boundTokenRanges/scanAtTokens，词中/邮箱不替换，未另写扫描）；③ restoreFileMentionTokens 反查优先（canonical → 原短 token，与发送展开互逆；↑ 召回历史时换回显示 token）。发送即消费未做（按拍板否决）。自测：typecheck/build 通过、单测 425 全绿（本轮新增 2 项反查优先用例）；测试报告 test/sandbox/verify.mention-bindings-lifecycle.report.html（F-01/F-02 新增 + R-01/R-02/R-03 回归全 pass，前两项为 harness 确定性场景 + DOM 断言，R-03 为沙盒真 dsh 端到端）→ doing → done
- 2026-09-08 认领：开发 session 开工（worktree mention-bindings）
- 2026-09-08 代码评审（4 角度子代理）确认后建条目 → open
- 2026-09-04 主 session 拍板：选 B 按会话归档（含 recall 反查 + 展开前边界校验），发送即消费否决；补「前置：paste-token-parsing-boundaries」→ 条目更新（仍 open/，排在其前置之后开发）
- 2026-09-04 主线合入后人工确认（用户审报告通过）→ closed
