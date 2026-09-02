# 发送失败时消息被吞：应把文本+图片+文件还原回输入框

记录于 2026-09-13。用户反馈：发送带图内容时，若当前模型不支持图片输入（`session.prompt failed: attachment-error`，如 `Model "deepseek-v4-flash" does not support image input.`），消息直接丢失——好不容易截图的内容找不回来。期望失败时消息（文本 + 附件）恢复进输出框而不是被吞掉。

## 根因

webview 侧 `sendCurrent()`（`src/ui/chat/webview.ts:4580-4625`）发送前就把输入框清空、`pendingImages`/`pendingFiles` 归零再 post `send`。宿主侧 `chatMessages.ts` 的 send handler 调 `target.send()` 抛错后只往上抛，`chatTab.ts:322` 弹「聊天操作失败：…」通知，没有任何还原动作——文本和 base64 图片只存在于 host RPC 调用栈里，报错后即丢弃。已有 `restoreDraft` 机制（stop 时把排队消息文本还回 composer，`chatMessages.ts:114-116`），但只处理文本、且发送失败的路径没用上。

## 建议方案

发送失败时宿主把消息还回 composer：catch `target.send()` 错误后 post `restoreDraft`（扩展携带 `images`/`files`），文本去掉 `<attachment>` 行（这些行还原成文件 chips，跟 webview 发送前的状态一致），图片原样带回去；webview 的 `restoreDraft` handler 追加图片/文件 chips 并重渲。错误通知继续由现有「聊天操作失败」路径弹。slack: 失败可能是任意原因（服务重启、模型不支持图片等），一律还原；⌘Enter 插话（steer）路径同样覆盖。

## 涉及代码位置

- `src/pure/chatContract.ts`（`ToWebviewMessage.restoreDraft` 定义）
- `src/ui/chatMessages.ts`（send handler catch）
- `src/ui/chat/webview.ts`（`restoreDraft` handler）

## 变更记录
- 2026-09-13 记录 → open，用户明确要求修复，立即认领 → doing
- 2026-09-13 开发完成，自测通过（typecheck + 328 test + build，done 标记 efb5fd3）→ done
- 2026-09-13 主线合入（merge 494ab8d），用户 dev-ui-test 验收通过 → closed
