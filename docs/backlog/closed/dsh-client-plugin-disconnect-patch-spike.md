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

## spike 结论（2026-09-05，session「调研 client-plugin 断连补丁」，主线已抽查核实）

**可行**——机制完整，非官方 seam 但全链路有实现且相互接通。四个问题：

1. **启用方式**：包 `package.json` 声明 `dsh.client`（`platform: "web"`、`inject`、`external`、`immediately`）+ 导出 `./client` bundle（缺失即激活时报错）。host 侧 `ClientModuleRegistry` 扫 cordis Loader entries 组成 `__DSH_BOOT__` 并经 `/plugins` 供 bundle。安装步骤：`dsh plugin --profile web add <路径>` → 纯 client 插件需手动在 `~/.dsh/profiles/web/cordis.patch.yml` 加一行 `- insert: [{id, name}]`（web profile `patchReload: live`，热重组不用重启）→ **刷新浏览器页面**拿新 `__DSH_BOOT__`。全部用户级 `$DSH_HOME`，无项目级配置。
2. **能力面**：`ctx.connection`（`state`/`generation` 双 observable + `reconnect()` 立即重连命令，`dsh-client-connection/lib/client.js:4825` provide）；cordis 事件 `connection/reset`（每次重连成功必发，`dsh-api-gateway/lib/client.js:1417`）——正是本次事故的检测点；`ctx.sessions.binding(id).eventSource`（revision/entries 带 seq）+ `snapshot.running` 可构造「侧栏在动、running=true、聊天 revision 不动」的精确停滞判定。
3. **目标形态**：两条检测信号都有 API（传输断开 = `connection.state` 持续 connecting/disconnected 超阈值；重连成功但聊天冻结 = `connection/reset` 后观察 eventSource.revision）。UI 槽位用 **`shell.overlay`**（`dsh-client-ui-layout/lib/client.js:261/454`：AppFrame 的绝对定位层，list 槽叠加不挤别人，当前无官方包注册，等于预留公共扩展位；每个 entry 独立 error boundary）。不要注册 `'root'`（single 槽会 shadow 掉整个 AppFrame）。
4. **生产生效**：`/plugins` 路由无条件注册，bundle 字节从磁盘读快照发不可变响应，全链路无 dev 分支；client-hmr 无 watcher 时纯空转。**注意：加插件后已打开的旧标签页不会自动获得，需刷新页面**。

主线抽查核实：`dsh plugin --profile web add`（bin.js）、`shell.overlay` 槽位、`ctx.provide("connection")`、`connection/reset` 发射点——四点全部属实。

**风险**：① 该机制 README 面向 maintainer，属内部 seam，上游改版可能打破（0.1.2-rc.1 证据确凿）；② 「reset 即提示」是保守策略，每次真实重连都弹一次，降噪需加 eventSource.revision + running 停滞判定。

→ 可行，实现条目另立：`dsh-disconnect-banner-plugin`（含最小 PoC）

## 变更记录

- 2026-09-05 用户要求（「如果3有必要就做吧」，判断：日常重度使用浏览器 GUI + 上游排期不可控，spike 成本低，有必要）：建条目（open/），并派发调研 session
- 2026-09-05 spike session 完成，结论：可行（结论已转录上方「spike 结论」节，主线抽查四点属实）→ closed；实现条目另立 dsh-disconnect-banner-plugin
