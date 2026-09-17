/**
 * `@dsh-one/dsh-context-menu` 的浏览器侧入口。
 *
 * 包清单的 `exports["./client"]` 指向本文件，`build.mjs` 以它为 entry 打官方 combo
 * 格式的 `lib/client.js`。插件本体就在本包里（同目录的 `contextMenuPlugin.ts`），
 * 本文件只把它的 `apply` / `inject` 转出去——**一个包 = 完整插件**，源与产物都在
 * 包内（#94）。
 *
 * 两端吃同一份产物，差别只有「谁来伺服这份 bundle」：
 * - VS Code 侧：build.mjs 把 `lib/client.js` 拷进 `dist/assembly/plugins/`，由
 *   loopback 代理伺服给 webview；
 * - 官方 web 侧：官方 client-modules 扫到本包的 `dsh.client` 声明，按
 *   `exports["./client"]` 读 `lib/client.js`。
 */
export { apply, inject } from './contextMenuPlugin.ts'
