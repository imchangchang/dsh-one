# 未安装 dsh 界面的非官方一键安装脚本

## 背景与现象

用户需求（2026-09-03）：dsh 官方没有任何 Windows/macOS/Linux 一键安装脚本（deepseek-harness 仓库无 .ps1，官方只有装 Node 后 `npx @deepseek-ai/dsh web`）。参考 kimi.com/code 的「安装 Kimi Code」界面（代码块 + 复制按钮），在 dsh-one 的 dshNotFound 空态里加一个说明 + 可复制的一键脚本，并自动探测当前平台、默认显示匹配平台的脚本。

## 现状

- dshNotFound 空态有两处：会话面板 `src/ui/sessionsWebview.ts`（renderServerEmpty）与聊天页 `src/ui/chat/webview.ts`（renderEmpty），都只有标题 + 引导 + 「View install guide」按钮。
- 已写好 Windows 安装脚本（install/dsh-install.ps1，此前在仓库根 install-dsh.ps1，2026-09-03 移入 install/）。

## 方案

1. 新增 `install/dsh-install.sh`：macOS/Linux 通用，自探测 uname/arch、复用兼容 Node（^22.19 || >=24）或装官方便携 tarball（SHA256 校验）、npm -g 装 pnpm + @deepseek-ai/dsh、PATH 写 shell rc，无 admin。
2. 新增 pure 层 `src/pure/installScript.ts`：HostOs 类型、平台探测（process.platform 映射）、各平台命令常量（指向 GitHub raw）。
3. ChatState/SessionsSnapshot 加 `hostOs`，host 端（chatTab EMPTY_STATE / sessionsView pushSessions）注入；两个 webview 空态加「非官方脚本」块：说明文案 + Windows/macOS/Linux 平台 chip（默认选中宿主平台）+ 命令代码块 + 复制按钮（Copy/Copied/Copy failed 复用现有 l10n key）。
4. 样式：sessionsView.ts 与 chatViewHtml.ts 各加 `.install-script*`；l10n 加一条「Or use the community one-liner script below (unofficial):」。

## 涉及代码位置

- install/dsh-install.sh、install/dsh-install.ps1
- src/pure/installScript.ts（新增）
- src/pure/chatContract.ts、src/ui/chatTab.ts、src/ui/sessionsView.ts
- src/ui/chat/webview.ts、src/ui/sessionsWebview.ts、src/ui/chatViewHtml.ts
- l10n/bundle.l10n.json、l10n/bundle.l10n.zh-cn.json

## 变更记录

- 2026-09-03 用户直接提出需求；主线 stash 后转入 worktree 开发（slug: unofficial-install-script-ui）。

- 2026-09-03 开发完成：自测通过（typecheck/build/test 337 通过），已打 done/unofficial-install-script-ui 标记，待主线合入前人工 dev-ui-test 验收。
