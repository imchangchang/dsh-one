/**
 * `@dsh-one/dsh-git-card` 的宿主半。
 *
 * 本插件的贡献全在浏览器侧（`exports["./client"]`，官方 loader 的行模块由本文件
 * 提供），宿主侧没有任何事要做——与官方 `@deepseek-ai/dsh-client-ui-brand-official`
 * 的宿主半同形（一个空 `apply`，只为给 loader 一行可挂的条目）。
 */
export function apply(): void {}
