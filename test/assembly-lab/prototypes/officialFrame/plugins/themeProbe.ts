/**
 * 主题观测探针（原型诊断件，#89 A/B 实验用）：把主题服务的偏好、每次 `theme/change`
 * 的负载、以及静置后的 DOM 状态打进 console——run.ts 的 P-11 把它们收进台账。
 *
 * 为什么要这个探针：官方 AppFrame 在场时收尾主题是浅色、自有 frame 在场时是深色，
 * 而两边的 theme 服务行为看起来一样。探针用来分辨「主题服务最后没修回来」还是
 * 「服务修回来了但没人再把 DOM 改回深色」。
 */
interface ThemeService {
  getTheme(): { preference: string; active: { colorScheme: string } }
}

export const inject = ['theme']

export function apply(ctx: {
  get(name: 'theme'): ThemeService
  on(event: 'theme/change', cb: (snapshot: unknown) => void): () => void
}): void {
  const theme = ctx.get('theme')
  const state = (): string =>
    `${theme.getTheme().preference}/${theme.getTheme().active.colorScheme} dom=${document.documentElement.style.colorScheme} darkAttr=${String(document.body.hasAttribute('data-ds-dark-theme'))}`
  console.log(`[probe] activate ${state()}`)
  ctx.on('theme/change', (snapshot) => {
    const value = snapshot as { preference?: string; active?: { colorScheme?: string } }
    console.log(`[probe] theme/change payload=${String(value.preference)}/${String(value.active?.colorScheme)} state=${state()}`)
  })
  for (const delay of [200, 1500, 4000]) {
    setTimeout(() => console.log(`[probe] settled+${String(delay)}ms ${state()}`), delay)
  }
}
