# 会话滚动位置恢复失败时应回到底部（而非落在错误位置）

记录于 2026-08-31。问题属于上游 dsh 官方包（dsh-client-ui-conversation / dsh-client-runtime），非 dsh-one 自身代码。

## 背景与现象

用户反馈：打开一些 session 时，滚动位置有可能不是离开时的位置。2026-08-31 在 http://127.0.0.1:3080 实测核实：

- 页面生命周期内切换会话再切回：位置**精确恢复**（含"加载更早"向上翻过的长会话），正常路径无 bug。
- **刷新页面后**：位置丢失，一律回到底部。
- **断线重连后**（休眠、网络抖动、服务重启均触发，代码路径推定 + 窗口塌缩已实测）：翻看过历史的会话会落在错误位置，且错误位置被立刻重新保存，原位置永久丢失。

## 根因

滚动位置按 sessionId 存在浏览器内存 Map（`dsh-client-ui-conversation/lib/client.js` 的 `chatScrollPositions`，约 9922 行），记录"锚点消息 key + 偏移 + scrollTop"，无持久化。两条失效路径：

1. 刷新/重启 web 服务 → Map 清空 → 回底部（行为本身可接受）。
2. 断线重连 → 客户端对已打开会话跑 `resync()`（`dsh-client-runtime/lib/client.js` 约 7425 行），消息窗口重置为最新约 50 条（`history({maxMessages: 50})`，实测窗口从 212 行塌缩到 137 行）。若离开前向上翻过历史，保存的锚点消息不在塌缩后的窗口里；恢复逻辑（`dsh-client-ui-conversation/lib/client.js` 约 5701-5716 行）找不到锚点行时只套用旧 `scrollTop` 数值，落在窗口中部一个无规律的位置，并马上 `chatScroll.save(normalized)` 把这个错误位置固化。

## 建议方案（已与用户讨论并认可）

锚点找不到时回到底部：恢复分支中 `anchorElement(local, saved.anchorKey) === null` 时直接 `toBottom(el)` + `chatScroll.save(null)`，不再套用失效的 scrollTop、不再保存错误位置。理由：底部是可预期的默认（与刷新后的行为一致）；且 `installWindow` 在 `openState` 翻成 `"open"` 前同步完成，恢复那一刻锚点不在 DOM 即说明不在当前窗口，无假阴性。

后续可选增强（暂不纳入本条）：锚点按 seq 持久化以跨刷新恢复；锚点不在窗口时自动 `loadOlder` 直至找到。

## 涉及代码位置

- `dsh-client-ui-conversation/lib/client.js`：`chatScrollPositions` Map（约 9922 行）、恢复分支（约 5699-5716 行）、滚动保存（约 5744-5766 行）。
- `dsh-client-runtime/lib/client.js`：`resync()`（约 7425 行）、`doOpen()` 的 `history({maxMessages: 50})`（约 7581-7599 行）。

注意：本地只有 npm 安装目录下的构建产物，直接 patch 会被版本升级覆盖，正式修复需提到上游 dsh 仓库。
