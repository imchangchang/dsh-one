# chat 正文反引号路径（行内码）不可点击打开，也无复制入口

## 背景与现象

用户反馈（2026-09-06）：要求产出原型图后，助手在正文里给出相对 workspace 的地址（反引号包裹的行内码，如 `` `test/ui/xxx.png` ``），该地址不能点击，必须在正文里用鼠标选中再复制，操作繁琐。期望：

1. 首选：这类相对路径地址可以直接点击，在 VS Code 中打开（与其他会话信息一样直达）；
2. 退而求其次（用户明确可接受）：行内码鼠标悬浮时显示复制标记，点击即复制，免去选中操作。

## 现状（已核实）

- **行内 code**（反引号）在 chat 正文里只有字体样式（`src/ui/chatViewHtml.ts` `.md code`，等宽 + 0.95em），无点击、无 hover、无复制交互。
- 已有的「可点击打开」通道两条，行内码都不走：
  1. **markdown 文件链接** `[x](path)`：webview 侧 `isFilePathHref` 识别 href → `post openPath` → 宿主 `resolvePathAgainst` 按附着会话 cwd 解析 → `openFileInEditor`（`src/pure/linkPath.ts`、`src/ui/chatMessages.ts`、`src/ui/chat/webview.ts`）。
  2. **产物行 chip**：assistant 消息 `producedFiles` 渲染成 chip，点击 `producedOpenFile` → 宿主直接打开（`webview.ts` `renderProducedFiles`）。
- 代码块（```）已有复制按钮（`enhanceCodeBlocks` + `.md-code-copy`），行内码没有对应物。

根因：行内码只是纯文本渲染；路径类内容既没有被识别为可打开链接，也没有复制入口。产物行依赖后端消息模型携带 `producedFiles`，正文里口头提到的路径不会进产物行——所以反引号路径是「唯一无交互」的路径呈现形态。

## 方案候选（未定）

1. **行内码路径可点击打开**（首选）：md 渲染后遍历行内 `<code>`，内容形状匹配路径（可复用 `isFilePathHref` 的判定逻辑，判断如 `test/ui/xxx.png`、`src/ui/webview.ts`、`/abs/path`、`~/x`）→ 包成可点击元素，hover 下划线/变色提示，点击 `post openPath`（宿主解析逻辑现成）。注意：与 `decorateCommitHashes` 同模式的树遍历装饰，流式重建下无状态、低风险。误触面：任意相对路径都会变可点——正是期望；非路径内容（命令、变量名）不受影响。
2. **行内码 hover 复制**（用户接受的兜底）：给全部行内 `<code>` 加 hover 复制按钮（块级复制反馈 `showCopyFeedback`/`initCopyFeedback` 可复用）；或只在 hover 时让码文本可整体选中的同时提供复制 icon。
3. **两者结合**：路径形状 → 点击打开（复制可用右键/选中）；非路径 → hover 复制。
4. **agent 输出侧约定**（不改代码的辅助措施）：正文里要指路径时写成 markdown 链接 `[xxx](xxx)`，或确保产物进入消息 `producedFiles`（产物行可点）。可作为提示词/约定写进 AGENTS.md 或系统提示。

倾向：先做 1 + 2 组合（路径可点、其余 hover 可复制），一次覆盖用户两个可接受形态。

## 涉及代码位置

- `src/ui/chat/webview.ts`：md 渲染后装饰逻辑（参照 `decorateCommitHashes` 的树遍历模式，行内 `<code>` 已允许被装饰）；`post({ type: 'openPath' })` 已有
- `src/pure/linkPath.ts`：`isFilePathHref`（当前只用于 href，文本内容判定可复用/抽函数）
- `src/ui/chatViewHtml.ts`：`.md code` hover 样式、复制按钮样式（参照 `.md-code-copy` / `.json-tree-copy-icon`）
- 宿主侧无需改动：`openPath` 处理与 cwd 解析已存在（`src/ui/chatMessages.ts`）
- `l10n`：复制/已复制可复用现有键；打开提示（title）可能需新键
- `test/ui`：sandbox 场景加行内码路径/非路径对照（参考 commit-hash 场景）

## 变更记录

- 2026-09-06 用户提出（原型图地址反引号路径不可点、复制繁琐，给出可点击打开 / hover 复制两种可接受方案）→ 核实现状（行内 code 无交互；markdown 链接与产物 chip 已可点；宿主 openPath 现成）→ 建条目（open/）

- 2026-09-06 认领 → doing。用户拍板开工：方案 1+2 组合——行内码路径形状可点击打开（复用 isFilePathHref 与宿主 openPath），其余行内码 hover 复制按钮。
