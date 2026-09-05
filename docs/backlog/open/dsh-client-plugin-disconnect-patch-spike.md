# spike：用 dsh client-plugin 机制给官方 web GUI 打断连补丁（可行性调研）

## 背景

官方 web GUI 聊天流静默卡死（见 `upstream-web-chat-stream-silent-freeze`）的治本在上游，但排期不可控，而我们自己日常重度使用浏览器 GUI（大管家 session）。dsh 有正式 client-plugin 机制（`dsh-client-modules`：插件包声明 `dsh.client` → host 组 boot graph → `/plugins` 下发 → 浏览器懒加载），如果能用它打补丁，就不用等上游。

## spike 要回答的问题

1. **启用方式**：client 插件怎么声明（`dsh.client` in package.json）、怎么被 host 加载——启用配置在哪（profiles？settings.yaml？`~/.dsh` 用户级还是项目级）
2. **能力面**：插件浏览器端能拿到什么——PLATFORM_MODULES（React/Cordis/静态 UI 库）之外，能否访问连接状态（`ctx.connection`、observable recovery state）和会话事件流
3. **目标形态可行性**：「聊天事件流停滞检测（session seq 前进但本页渲染停滞 / WS 断开）→ 显示断连横幅或 `location.reload()`」能否实现；有哪些 UI 槽位（renderSlot 类）可用
4. **生产生效**：用户正常用的 `dsh web`（生产构建，无 dev watcher）下插件是否生效（`dsh-client-hmr` 是开发专用；生产走 `/plugins` 静态服务）

## 约束与产出

- 只读调研：本机 checkout `~/.nvm/.../@deepseek-ai/dsh/`（重点 `dsh-client-modules` / `dsh-client-hmr` / `dsh-client-connection` / `dsh-web-app` / `dsh-host-frontend-static` / `dsh-client-ui-*`），不改 dsh 安装、不动 `~/.dsh` 配置、不写本仓库代码
- 产出：可行性结论（可行/不可行/部分可行）+ 可行则给最小 PoC 形态（插件包结构、声明、核心代码思路、启用步骤），引用具体文件/行做证据
- 结论写回本条目（「spike 结论」节）；可行 → 另立实现条目；不可行 → 本条 closed，只靠上游 issue

## 变更记录

- 2026-09-05 用户要求（「如果3有必要就做吧」，判断：日常重度使用浏览器 GUI + 上游排期不可控，spike 成本低，有必要）：建条目（open/），并派发调研 session
