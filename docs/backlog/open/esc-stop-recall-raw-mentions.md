# ESC 中断/↑ 召回后 composer 里 @ 标签和附件显示成路径原文

记录于 2026-09-06。用户反馈：有消息正在发送或等待插话时按 ESC 中断对话，再按 ↑ 把上一次的消息拉回输入区，消息里的 @ 标签和图片/文件附件会以路径（canonical 原文）形式显示，不符合预期。

## 核实过程（UI 沙盒实测，2026-09-06）

用 `test/ui/harness.html` + 真实 `dist/chatWebview.js`（主线构建）复现确认：

- **ESC 抽干回填（主路径）**：steering-pending 场景（队列里有含 `@[旧会话](dsh-session:…)` + `<attachment>…/README.md</attachment>` + 一张粘贴图的插话消息）→ ESC → 按真实宿主逻辑投 `restoreDraft`（raw editText）。composer 实际内容：
  ```
  等等，先停下，看看 @[旧会话](dsh-session:InNlc3MtMyI) 的状态。
  <attachment>/Users/cgeng/Workspaces/dsh-one/README.md</attachment>
  ```
  会话标签保持 canonical、附件变字面路径行、粘贴图丢失。截图证据：/tmp/dsh-ui-shots/repro-esc-stop-drain.png。
- **↑ 召回历史消息**：投喂最后一条用户消息（含 canonical `@/长路径`、`files`、`images`）后按 ↑——`@/长路径` 正确还原成 `@img1.png` 短 token（`restoreFileMentionTokens` 反查/重生成都工作）、`files` 恢复成 chip，但 **`images`（粘贴图）完全没恢复，静默丢失**。

## 根因

发送时 composer 内容被转成内部形态：@ 文件/会话标签展开成 canonical（`@/长路径`、`@[标签](dsh-session:…)`），文件附件拼成 `<attachment>路径</attachment>` 行。拉回输入区需要逆转这个转换，但四条拉回路径逆转程度不一致：

| 拉回路径 | 位置 | 缺口 |
|---|---|---|
| ESC 停止抽干队列 | `chatSession.ts:632 stop()` + `chatMessages.ts:447-456` | 直接回填 raw editText：没走 `splitAttachmentLines`（附件变字面路径行）、没还原图片/文件 chips、会话标签保持 canonical、粘贴图丢失 |
| ↑ 召回排队消息 | `webview.ts:7444` | 同样直接用 raw editText，症状相同 |
| ↑ 撤销插话（unsteer） | `chatSession.ts:668-686` | 附件行拆了、图片按 attachmentId 重拉了（对的），但会话标签 canonical 没还原 |
| ↑ 召回历史消息 | `webview.ts:7445-7456` | @ 路径/文件 chip 都对，但 `lastUser.images`（粘贴图）没恢复 |

对照组：unsteer 和发送失败还原（`chatMessages.ts:434-441`）都做了 `splitAttachmentLines` + chips 还原，唯独 stop 路径没做——最直接的根因。另外 `restoreFileMentionTokens`（`src/pure/fileReference.ts:135`）只处理带分隔符的路径 @ token，对 `@[标签](dsh-session:…)` 会话标签一概不还原，这在所有非历史召回路径都是缺口（历史路径侥幸没事只是因为 dsh 落盘的直接用户消息是可读 `@标签` 文本）。

## 建议方案

- stop/queue-recall 路径复用 unsteer 那套还原：`splitAttachmentLines` 拆附件行 → chips，图片按 attachmentId 重拉字节（stop 目前只返回文本，需要 chatSession.stop 改成返回 `{text, images, files}` 结构）。
- 加一个 `restoreFileMentionTokens` 的会话标签 counterpart（canonical `@[标签](dsh-session:id)` → 显示 token + 登记绑定，与 `mentionDisplayToken`/`formatSessionMention` 互逆），所有回填路径统一调用。
- 历史召回补上 `lastUser.images` 的恢复（按 attachmentId 拉字节，同 unsteer）。
- 每条路径配 UI 场景（test/ui/scenarios.js）防回归。

## 涉及代码位置

- `src/server/chatSession.ts`（`stop()` 632-650 / `unsteer()` 668-686 / `queueItemOf` 103-122）
- `src/ui/chatMessages.ts`（stop 处理 447-456 / 发送失败还原 427-443 / unsteer 597-614）
- `src/ui/chat/webview.ts`（restoreDraft 处理 1527-1549 / ↑ 召回 7424-7459 / `restoreFileMentionTokens` 调用点）
- `src/pure/fileReference.ts`（`restoreFileMentionTokens`）、`src/pure/sessionMention.ts`（`formatSessionMention`/`mentionDisplayToken`/`parseSessionMentions`）

- 2026-09-06 记录（根因已定位，UI 沙盒复现确认）→ open
