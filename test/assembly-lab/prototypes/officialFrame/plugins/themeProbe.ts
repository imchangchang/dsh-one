/** 一次性诊断插件（临时）：把主题服务的 preference 与每次 theme/change 打到 console。 */
interface ThemeService {
  getTheme(): { preference: string; active: { colorScheme: string } }
}
export const inject = ['theme']
export function apply(ctx: { get(name: 'theme'): ThemeService; on(event: 'theme/change', cb: (s: unknown) => void): () => void }): void {
  const theme = ctx.get('theme')
  const snap = (): string => `${theme.getTheme().preference}/${theme.getTheme().active.colorScheme}`
  console.log(`[probe] activate preferred=${snap()}`)
  ctx.on('theme/change', (s) => {
    const value = s as { preference?: string; active?: { colorScheme?: string } }
    console.log(`[probe] theme/change preference=${String(value.preference)} scheme=${String(value.active?.colorScheme)} now=${snap()}`)
  })
}
