/**
 * @dsh-one/vscode-sidebar-shell 的 esbuild 入口：build.mjs 用 banner/footer 把本
 * bundle 包成官方自注册形态——
 *   window.__ModuleLoader__.load({ id: "@dsh-one/vscode-sidebar-shell",
 *     factory: (require) => { …bundle…; return module.exports } })
 * externals（react / react/jsx-runtime / @deepseek-ai/cordis /
 * @deepseek-ai/dsh-client-store）在 bundle 内保持 require() 调用、落在
 * factory 作用域里由模块系统的种子表满足（#63 调研结论，打进包会双重实例化）。
 */
export { apply, inject } from './sidebarFramePlugin.ts'
