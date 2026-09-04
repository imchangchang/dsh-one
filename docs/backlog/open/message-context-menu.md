# 消息气泡右键菜单：复制

## 背景与现象

对话气泡（user/assistant 消息）没有右键菜单——现有右键菜单只属于外链和会话行。assistant 消息操作栏已有复制按钮（纯文本），user 消息无复制。需求：气泡右键直接复制。

## 复制（已拍板）

- 消息级右键菜单，user / assistant 消息都显示，两项：
  - **复制文字**：纯文本（复用 `assistantText`；user 取 `text`）
  - **复制文字和附件**：见下
- 附件范围（已确认）：user = images + files；assistant = producedFiles 也算附件。
- 附件形态（已确认）：
  - 图片 = 真实图片二进制写入剪贴板；**多图全部写入**，多数粘贴目标只认第一张，剩余以路径文本兜底（文本部分列出全部路径）。
  - 文件 = markdown 引用 `[文件名](路径)`（webview 剪贴板无法复制文件本体，只能文本）。
- 两项菜单对 user/assistant 都显示（已确认），无附件时「复制文字和附件」退化为纯文字。

## 涉及代码位置

- `src/ui/chat/webview.ts`：
  - 消息级右键菜单（新建；坐标定位弹层模式可复用 ~1325 外链菜单）
  - `assistantText` (~4496)；user 文本（`ChatUserMessage.text`，含 images/files 的文本段落还原）
  - 剪贴板写多项目（`navigator.clipboard.write`，图片 blob + text/plain + 附件路径文本）
- `src/pure/chatContract.ts`：复制为 webview 内本地动作（剪贴板直接写，不走 host），预计无需新消息。

## 变更记录

- 2026-09-04 需求提出（用户：气泡右键直接复制，及「最后一条对话可编辑重做」——编辑部分后续被砍，见下条）；核实现状（无消息级右键菜单、复制仅 assistant 操作栏纯文本、dsh 无消息替换 API）。
- 2026-09-04 复制部分拍板（两项菜单恒显示 / user=images+files、assistant 含 producedFiles / 多图全写 + 路径文本兜底 / 文件用 markdown 引用）。
- 2026-09-04 用户决定**砍掉编辑相关功能**（编辑重发 / 分支重做，含此前讨论过的 E1 追加 / E2 分支方案与交互原型 `.dev-host/msg-menu-proto.html`），本条目只保留复制；「复制文字和附件」的剪贴板写入细节（多项目、路径兜底）不受影响。
