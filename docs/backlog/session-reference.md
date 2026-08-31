# 对话引用（@会话）

记录于 2026-08-30。类型：需求（已调研，方案可行）。

## 需求

右键复制一个对话的引用信息（id 等），在输入框里 @ 这个会话，把它的内容作为上下文引入当前对话。

## 调研结论（dsh 侧已核实）

dsh 对这个功能有**完整的 host 侧支持**，不需要我们发明协议：

- **提及语法**（dsh-session-reference）：`@[标题](dsh-session:<base64url(JSON.stringify(sessionId))>)`，或直接裸写 canonical URI。base64url 编码保证任意字符的 session id 往返无损。
- **生效链路**：mention 作为普通文本随 `session.prompt` 发送即可；host 在 `agent/pre-step` 解析 direct user message 里的 mention，读取被引用会话的**只读快照**注入为紧随其后的 sourced context 消息（带"不可信内容"警告，模型不得执行快照里的指令）。快照语义：compaction 后的会话只贡献最新 checkpoint + 之后保留的对话；只投影文本块；引用是快照不是活链接。
- **限额**：一条消息最多 3 个不同来源（`maxReferences`），每个来源序列化上限 64KB（`maxReferenceBytes`），超出整轮失败（SESSION_REFERENCE_BUDGET_EXCEEDED）。
- **插件随 dsh-web-app 默认组合加载**（dsh-web-app/package.json 依赖了 dsh-session-reference），我们的 dsh web 部署自带。
- **官方 UI 参照**（dsh-client-ui-reference）：@ 触发统一候选（文件在前、会话在后，分区标题），选中插入"原子内联引用"——可见形态是气泡图标+会话标题，隐藏/剪贴板形态是 canonical mention。

## 建议方案（dsh-one 侧）

1. **复制引用**：会话行「⋯」菜单/右键加「复制引用」，剪贴板写入 canonical `@[标题](dsh-session:...)` 整串（用户粘贴即用）；可选再加「复制会话 ID」。
2. **输入框 @ 补全**：复用现有斜杠命令补全框架（webview.ts 的 COMPLETABLE_COMMANDS 那套），`@` 触发会话候选（按标题/id 子串过滤，参考 listCandidates 的同 cwd 优先排序）。
3. **插入形态（已定，2026-09 澄清）**：输入框是 textarea，做不到官方 contenteditable 的原子引用。确定走 b) 路线：输入框只显示 `@标题`，本地维护 标题→mention 映射，发送时替换为 canonical mention。需要处理标题重复、发送后改名、手动编辑删改等边界。明确不采用 a) 直接插入 mention 全文。
4. **渲染**：消息里的 mention 可在 webview 渲染时识别 `@[..](dsh-session:..)` 模式，显示为「@标题」链接样式（点击可附着该会话）。

## 开发时验证项

- 候选发现：host 的 Remote 方法 `sessionReferenceResolver/candidates` 能否走我们的 HTTP `/api/` 通道（官方浏览器端走 ctx.remote，未走 apiproxy 路由）；不能就用 session.list 自组候选（标题/id 都有），mention 串本地拼。
- 实测我们的 HTTP session.prompt 发出的消息是否被 session-reference 服务正常捕获（应为 direct user message，预期可行）。
- host 快照注入后，我们的 ConversationFolder 会收到一条 source.kind 为 session-reference 的 user/message——确认它落入现有"注入上下文"折叠卡（context 标记路径），不要渲染成普通用户消息。

## 涉及代码

- `src/ui/chat/webview.ts`：@ 补全（斜杠补全旁）、mention 渲染、右键菜单项。
- `src/ui/chatView.ts`：复制引用命令（clipboard）、样式。
- `src/server/dshRpc.ts`：如需 candidates Remote 方法，加封装。
- `src/pure/`：mention 编解码/解析小函数（encode/decode/parse 对齐 host 格式），配测试。
