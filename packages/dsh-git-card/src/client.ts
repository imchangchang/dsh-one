/**
 * `@dsh-one/dsh-git-card` 的浏览器侧入口。
 *
 * 插件本体住在仓库的共享源码里（`src/ui/assembly/shell/gitCardPlugin`），
 * 本文件只做**包边界**：同一份源码既打成 VS Code 装配用的 bundle，也打成这个包的
 * 官方格式 `lib/client.js`，不复制第二份（#73 的「别复制粘贴」）。
 * 两端的差别只有「谁来伺服这份 bundle」：
 * - VS Code 侧：build.mjs 把 `lib/client.js` 拷进 `dist/assembly/plugins/`，由
 *   loopback 代理伺服给 webview；
 * - 官方 web 侧：官方 client-modules 扫到本包的 `dsh.client` 声明，按
 *   `exports["./client"]` 读 `lib/client.js`。
 */
export { apply, inject } from '../../../src/ui/assembly/shell/gitCardPlugin.ts'
