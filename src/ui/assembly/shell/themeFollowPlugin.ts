/**
 * @dsh-one/vscode-theme-follow——主题跟随小插件（#70 VS Code 验收项 1），三棵
 * 装配树共用。宿主（assemblyView）在 VS Code 颜色主题变化时 postMessage
 * {type:'dshOne.setTheme', theme}，本插件走官方 theme 服务的正规口覆写：
 *
 * 路线选择（读 ui-theme client.js 源码后的判定）：
 * - setTheme('light'|'dark'|'system') 会写网关 settings 文档（host.set），
 *   污染官方 web 前端——双前端边界不允许。
 * - register({id, colorScheme, tokens}) + setTheme(自定义 id)：isThemePreference
 *   对内建 id 才写 host，自定义 id 只做本地 publish()——正是「不写网关」的
 *   程序化覆写口。built-in light/dark 的 tokens 为空（调色板在基础样式表，
 *   随 data-ds-dark-theme/color-scheme 切换），自定义主题同样空 tokens 即可。
 * - overrideTokens 备选未用：它按 token 叠层，要拿全量对立调色值（CSSOM 枚举
 *   几百个 token），而 colorScheme 维度正好是整个调色板的开关。
 *
 * 回弹防护：网关 settings 文档变化时 ui-theme 的 adopt() 会把 preference
 * 拉回文档值（改字号/外观行都会触发）。这里订 theme/change 复查——被拉走
 * 就重新 setTheme 回来（第二次 publish 因 preference 相同早退，不会成环）。
 * 副作用：设置 modal 里的外观行对本装配页失效（写网关不生效于本页），
 * VS Code 主题是装配页唯一主题权威——这是 #70 验收的既定语义。
 */
import type { ThemeSnapshot } from './frameShared'

/** 官方 theme 服务面（ThemeRuntime 实例，ui-theme ctx.provide('theme', ...)）。 */
interface ThemeService {
  getTheme(): ThemeSnapshot & { preference: string }
  setTheme(id: string): void
  register(definition: {
    id: string
    colorScheme: 'dark' | 'light'
    tokens: Record<string, { light: string; dark: string }>
  }): () => void
}

interface ThemeFollowContext {
  get(name: 'theme'): ThemeService
  on(event: 'theme/change', listener: (snapshot: ThemeSnapshot) => void): () => void
  effect(body: () => (() => void) | void, label?: string): void
}

/** VS Code 侧当前主题（宿主经装配页 theme 参数烘进 first frame，见 pageHtml.ts）。 */
const bootTheme = (): 'dark' | 'light' | undefined => {
  const raw = (globalThis as { __DSH_ONE_HOST_THEME__?: unknown }).__DSH_ONE_HOST_THEME__
  return raw === 'dark' || raw === 'light' ? raw : undefined
}

export const inject = ['theme']

export function apply(ctx: ThemeFollowContext): void {
  const theme = ctx.get('theme')
  // 注册 VS Code 配色承载主题：空 alias 层（调色板在基础样式表），只承载 colorScheme。
  const disposers = [
    theme.register({ id: 'vscode-dark', colorScheme: 'dark', tokens: {} }),
    theme.register({ id: 'vscode-light', colorScheme: 'light', tokens: {} }),
  ]
  let desired: 'vscode-dark' | 'vscode-light' | undefined

  const applyDesired = (): void => {
    if (desired === undefined) return
    if (theme.getTheme().preference !== desired) theme.setTheme(desired)
  }

  const setDesired = (theme_: 'dark' | 'light'): void => {
    desired = theme_ === 'dark' ? 'vscode-dark' : 'vscode-light'
    applyDesired()
  }

  // 首帧：装配页 theme 参数已把 document 烘成目标色，这里同步 preference。
  const boot = bootTheme()
  if (boot !== undefined) setDesired(boot)

  // 宿主主题切换广播（VS Code webview message；普通浏览器无宿主，永不触发）。
  const onMessage = (event: MessageEvent): void => {
    const data = event.data as { type?: unknown; theme?: unknown } | undefined
    if (data?.type === 'dshOne.setTheme' && (data.theme === 'dark' || data.theme === 'light')) {
      setDesired(data.theme)
    }
  }
  window.addEventListener('message', onMessage)

  // adopt() 回弹复查：preference 被网关设置文档拉回时重新跟随 VS Code。
  const offChange = ctx.on('theme/change', () => {
    if (desired !== undefined && theme.getTheme().preference !== desired) applyDesired()
  })

  ctx.effect(() => {
    return () => {
      window.removeEventListener('message', onMessage)
      offChange()
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-one theme follow: dispose')
}
