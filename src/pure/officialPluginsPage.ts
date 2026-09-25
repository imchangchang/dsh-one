/**
 * 「这一代的官方有没有插件页」这条判据（#253）——宿主与页面共用一处。
 *
 * ## 判据是什么
 *
 * 看**这一份插件清单里有没有官方插件页那一件包**（`@deepseek-ai/dsh-client-ui-plugin-manager`）。
 * 两个消费点读的是同一份东西的两个影子：页面侧读本页 `__DSH_BOOT__`（官方给 shell 预留的
 * 启动清单 seam，blocklist 过滤后内联进页面），宿主侧读它给某棵树 `filterWire()` 出来的
 * 那份清单（就是即将装进那一页的清单）。官方这一件包在，那一页就有；不在，那一页就没有。
 *
 * ## 为什么是这条读数，而不是别的（三条候选逐条实测过）
 *
 * 1. **不按 dsh 版本号比较**。版本号是外部事实，得跟着官方发版维护；而且 `dsh` 自己的
 *    依赖写的是范围（`^0.1.6-alpha.1`），装机上的子包版本与 `dsh` 自己并不总是同一条，
 *    按版本号算会在「装了半旧半新一棵树」的机器上给出错的答案。机制读数随官方自己走。
 * 2. **不能读「`sidebar.panellist` 这个座在不在」**。#252 写下时以为那个座是 0.1.6-alpha.2
 *    起才有的，实测不是：解开 npm 上 `@deepseek-ai/dsh-client-ui-sidebar` 的
 *    `0.1.5-rc.3` 与 `0.1.6-alpha.1` 两份产物，`sidebar.panellist` 两代**都在**
 *    （`lib/client.js` 里那三处：壳自己 `renderSlot("sidebar.panellist", …)`、
 *    `ctx.slots.entriesOfSlot("sidebar.panellist")`、`ctx.slots.subscribe("sidebar.panellist", …)`）。
 *    座在、座上没人，正是这两代的形状；按座判会把「官方没有插件页」的两代判成「有」。
 * 3. **也不能读「座上有没有 id `plugins` 那个条目」**。侧栏 frame 自己按同 id + priority −1
 *    往那一格注册了遮蔽件（`sidebarLayoutPlugin`，遮蔽官方那条行）——格子里那个 id 恒定
 *    在场，读数恒真，等于没有判据。（要把我们那条排除掉只能比注册方或组件的身份，
 *    那是比这份清单更弱的一层证据：官方给 `StoredEntry` 的 `registrant` 只是诊断字段，
 *    官方文档写的是「diagnostics label」，不保证形状。）
 *
 * 官方那一件包的版本表就是这件事的直接证据：`npm view
 * @deepseek-ai/dsh-client-ui-plugin-manager versions` → `0.1.6-alpha.2` 起才有
 * （0.1.5-rc.2 / 0.1.5-rc.3 / 0.1.6-alpha.1 的 `dsh-web-app` 依赖表里都没有它），
 * 而这个包的全部作用就是那一页：它注册 keyed `main`（key `plugins`，页面本体）与
 * `sidebar.panellist` 上 id `plugins` 那一行（入口）。清单里有它 = 这一代有那一页。
 *
 * 先例：实验室 F-72 判「这一代官方有没有『取消归档』」用的就是这条读法
 * （读官方清单里有没有那一件包，不按版本号猜）。
 */

/** 官方「插件」页那一件包（页面本体与侧栏那条入口都由它注册）。 */
export const OFFICIAL_PLUGINS_PAGE_PLUGIN_ID = '@deepseek-ai/dsh-client-ui-plugin-manager'

/**
 * 这份插件清单里有没有官方插件页那一件包。
 *
 * `wire` 的形状就是 `__DSH_BOOT__` / `BootWire` 的清单形状（`{ entries: [{ id, url, rev }] }`），
 * 也只读它的 `entries` 一栏。形状对不上（清单不在场、字段不是数组）一律回 false
 * ——**判据缺席时按「这一代没有」处置**：宁可少一枚入口，也不要给用户一枚点开是空白的按钮。
 */
export function hasOfficialPluginsPage(wire: unknown): boolean {
  if (typeof wire !== 'object' || wire === null) return false
  const entries = (wire as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return false
  return entries.some(
    (entry) =>
      typeof entry === 'object' && entry !== null && (entry as { id?: unknown }).id === OFFICIAL_PLUGINS_PAGE_PLUGIN_ID,
  )
}

/** 页面侧：本页 `__DSH_BOOT__` 清单里的读数（页面每棵树各自一份内联清单）。 */
export function pageHasOfficialPluginsPage(): boolean {
  return hasOfficialPluginsPage((globalThis as { __DSH_BOOT__?: unknown }).__DSH_BOOT__)
}
