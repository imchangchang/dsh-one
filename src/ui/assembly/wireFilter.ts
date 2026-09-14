/**
 * blocklist 模式的运行时装配清单（#64)：面板打开时扩展宿主（node 侧，无
 * CORS)用 serverAuth 的 cookie GET 网关 `/`，从注入 HTML 提取官方
 * __DSH_BOOT__ wire 与前端资产名，按 BLOCK_LIST 过滤后内联进装配页——
 * 插件集 = 网关启动的全量插件 − blocklist + 自有 shell 插件。
 * （替代原静态 allowlist：18 包 pin + 构建期 manifest.json 已删除。)
 *
 * 关键事实（探针结论，见 #64 汇报)：
 * - 网关 **拒绝任意重拼的 combo**（rev 是内容校验，重拼即 404)，单包 URL
 *   也只认各自的精确 rev——所以过滤不是改 URL 指向网关，而是：
 *   application 批 URL 改指 mirror 的 /plugins-local（mirror 拉官方原 combo
 *   按 __ModuleLoader__.load 边界剥掉 blocked 段后伺服，见 assemblyMirror)。
 * - bootstrap 批只有 client-modules，永不过滤。
 */

/** 前端资产清单（从网关 / 注入 HTML 解析，哈希文件名不硬编码)。 */
export interface GatewayAssets {
  moduleJs: string
  preloadJs: string[]
  css: string[]
}

export interface BootWireEntry {
  id: string
  url: string
  rev: string
  inject?: string[]
  external?: string[]
  immediately?: boolean
}

export interface BootWireBatch {
  phase: 'bootstrap' | 'application' | string
  url: string
  rev: string
  entries: string[]
}

export interface BootWire {
  rev: string
  entries: BootWireEntry[]
  batches: BootWireBatch[]
}

/**
 * blocklist：从网关全量清单剔除的官方插件（checked-in 常量，一条一理由)。
 * 追加标准：加载全量后因缺服务 loud throw 或功能硬损坏的插件，按同格式记录。
 */
export const BLOCK_LIST: ReadonlyArray<{ id: string; reason: string }> = [
  {
    id: '@deepseek-ai/dsh-client-ui-layout',
    // 官方应用外框，与 VS Code 外壳冲突；由 @dsh-one/vscode-shell 接管根组合并提供 layout 服务
    reason: 'official app frame conflicts with the VS Code shell; @dsh-one/vscode-shell takes over root composition and provides the layout service',
  },
  {
    id: '@deepseek-ai/dsh-client-ui-sidebar',
    // 官方侧栏，VS Code 侧栏由自研面板承担
    reason: 'official sidebar; the VS Code sidebar is served by dsh-one\'s own panel',
  },
]

export const BLOCKED_IDS: Readonly<string[]> = BLOCK_LIST.map((b) => b.id)

/** 自有 shell 插件 id（root 外框/layout 桩/ThemePresenter，经 mirror /plugins-local 伺服)。 */
export const SHELL_PLUGIN_ID = '@dsh-one/vscode-shell'

/** 从网关 `/` 注入 HTML 提取 __DSH_BOOT__ JSON（官方把 `<` 转义成 \u003c，JSON.parse 直接还原)。 */
export function extractBootWire(html: string): BootWire {
  const m = /globalThis\["__DSH_BOOT__"\] = (\{[\s\S]*?\})<\/script>/.exec(html)
  if (m === null) throw new Error('assembly wire: gateway HTML has no __DSH_BOOT__ injection')
  try {
    return JSON.parse(m[1]) as BootWire
  } catch (err) {
    throw new Error(`assembly wire: __DSH_BOOT__ JSON parse failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 从网关 `/` 注入 HTML 解析前端资产名（module js / modulepreload / css，全部相对路径)。 */
export function extractFrontendAssets(html: string): GatewayAssets {
  const moduleJs = /type="module"[^>]*src="\.\/(assets\/[^"]+)"/.exec(html)?.[1]
  if (moduleJs === undefined) throw new Error('assembly wire: gateway HTML has no module script asset')
  const preloadJs = [...html.matchAll(/modulepreload"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  const css = [...html.matchAll(/stylesheet"[^>]*href="\.\/(assets\/[^"]+)"/g)].map((m) => m[1])
  if (preloadJs.length === 0 || css.length === 0) {
    throw new Error('assembly wire: gateway HTML has no modulepreload/stylesheet assets')
  }
  return { moduleJs, preloadJs, css }
}

/**
 * 过滤 wire：剔除 BLOCK_LIST 条目；application 批 combo URL 改指 mirror 的
 * /plugins-local（mirror 伺服剥掉 blocked 段的官方原 combo，rev 沿用原值)；
 * 追加自有 shell entry 并入 application 批；bootstrap 批原样不动。
 */
export function filterWire(wire: BootWire): BootWire {
  const blocked = new Set(BLOCKED_IDS)
  const entries = wire.entries.filter((e) => !blocked.has(e.id))
  const dropped = wire.entries.filter((e) => blocked.has(e.id))
  if (dropped.length !== BLOCKED_IDS.length) {
    const missing = BLOCKED_IDS.filter((id) => !dropped.some((e) => e.id === id))
    throw new Error(`assembly wire: gateway wire is missing expected blocklist entries: ${missing.join(', ')}`)
  }
  const app = wire.batches.find((b) => b.phase === 'application')
  const bootstrap = wire.batches.find((b) => b.phase === 'bootstrap')
  if (app === undefined || bootstrap === undefined) {
    throw new Error('assembly wire: missing bootstrap/application batch')
  }
  const keptIds = app.entries.filter((id) => !blocked.has(id))
  if (keptIds.length !== app.entries.length - BLOCKED_IDS.length) {
    throw new Error('assembly wire: application batch blocklist entries inconsistent with wire entries')
  }
  const shellEntry: BootWireEntry = {
    id: SHELL_PLUGIN_ID,
    url: `/plugins-local/??${SHELL_PLUGIN_ID}/client.js&rev=${app.rev}`,
    rev: app.rev,
  }
  entries.push(shellEntry)
  const comboIds = [...keptIds, SHELL_PLUGIN_ID]
  return {
    rev: wire.rev,
    entries,
    batches: [
      bootstrap,
      {
        phase: 'application',
        // mirror 的 /plugins-local：combo 含 kept + shell；mirror 拉官方原 combo
        // 剥 blocked 段、拼上本地 shell bundle 后伺服；rev 沿用网关原值（缓存键)。
        url: `/plugins-local/??${comboIds.map((id) => `${id}/client.js`).join(',')}&rev=${app.rev}`,
        rev: app.rev,
        entries: comboIds,
      },
    ],
  }
}
