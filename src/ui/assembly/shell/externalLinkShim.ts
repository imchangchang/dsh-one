/**
 * 外链锚点的捕获阶段兜底（#150）。
 *
 * ## 它补的是哪一件事
 *
 * VS Code 的 webview 里，`<a href="https://…" target="_blank">` 能打开系统浏览器，
 * 靠的是 VS Code 自己在页面里装的那层链接拦截：VS Code 1.138.0 的
 * `Contents/Resources/app/out/vs/workbench/contrib/webview/browser/pre/index.html` 里
 * `handleInnerClick` 挂在页面 window 的**冒泡阶段**
 *（同文件 `contentWindow.addEventListener('click', handleInnerClick)`），在点击路径上找到
 * 带 href 的锚点就 postMessage 给宿主（宿主调系统浏览器），同时 `preventDefault()`。
 *
 * 冒泡阶段意味着：路径上任何一个处理函数调了 `event.stopPropagation()`，事件就到不了
 * 那一层，点击看起来「没反应」。浏览器里没有这层拦截，锚点自己的默认行为照常把
 * `target="_blank"` 开出去，所以同一个插件在官方 web 上一直是好的。
 * `@dsh-one/dsh-llm-provider` 的「打开官网 ↗」「获取密钥 ↗」正是这种锚点：普通 `<a>`，
 * 只是 onClick 里调了 `event.stopPropagation()`（React 合成事件的 stopPropagation
 * 会连带调原生事件的那一个）。
 *
 * ## 兜底做的事
 *
 * 在 `document` 的**捕获阶段**（早于锚点自己那个 React 处理函数）听 `click`：事件路径上
 * 有 `<a href>` 且 href 是 http/https/mailto 时，把这次点击交给宿主能力口的
 * `openExternal`（VS Code 侧 = `vscode.openExternal`；官方 web 侧 = 页面 `window.open`），
 * 并 `preventDefault()` 掐掉页面自己的导航。白名单复用 `parseAllowedUrl`（与能力口同一份，
 * 不再写第二份）；不命中时一个字节都不动，页面原生行为照旧。
 *
 * ## 命中后为什么要 `stopPropagation()`
 *
 * VS Code 那层拦截**不看** `defaultPrevented`：只要路径上有锚点它就 postMessage 给宿主。
 * 所以只 `preventDefault()` 的话，同一次点击会既走我们的能力口、又被 VS Code 再开一次
 * （用户看到两个浏览器窗口）。捕获阶段 `stopPropagation()` 让事件不再往下走，VS Code 那层
 * 收不到，打开就恰好一次。
 *
 * 代价如实记在这里：被接管的这一次点击，路径上其余处理函数（含锚点自己的 React onClick）
 * 不会执行。对「外链就是要把链接打开」这类锚点这正是想要的结果；将来若有插件在外链锚点上
 * 挂别的副作用，那条副作用得挪到别处（或改用按钮）。
 *
 * ## 什么时候装、装在哪
 *
 * 兜底补偿的是 VS Code webview 的行为，所以只在宿主注入过 `acquireVsCodeApi` 的页面里装
 * （「这个页面在 webview 里」的判据与 `ui/assembly/probe.ts`、`ui/assembly/hostSdk.ts`
 * 同一处来源）；官方 web 与普通浏览器里锚点本来就打得开，不接管。三棵树各只有一个 frame
 * 插件，各自的 `apply` 调一次本函数（三份 bundle 共用这一份源码），页面级再加一道全局
 * 标记防重装。
 *
 * ## 走的是哪一层机制
 *
 * 文档级 DOM 事件（AGENTS.md 机制优先序的第 4 层）：VS Code 的 webview API 没有「自定义
 * 链接处理」的接缝——官方行为就是上面那层拦截本身；dsh 侧也没有对应机制（外链不是 dsh
 * 的槽位或服务能管的事）。风险：本兜底依赖 `handleInnerClick` 的两条行为（在冒泡阶段、
 * 不看 `defaultPrevented`），它变了最多退化成「开两次」或「照旧打不开」，不会引发出别的问题；
 * 可观测的因（能力口调用次数）由验证套件 F-48 常驻盯住，读法见该套件说明。
 */
import { parseAllowedUrl } from '../../../pure/hostCapabilities.ts'
import { hostCapabilities } from '@dsh-one/dsh-plugin-kit/hostCapabilities'

/** 页面级「兜底已经装过了」的标记（三棵树的 frame 插件是同族三份 bundle，页面级只装一层）。 */
const INSTALLED_FLAG = '__DSH_ONE_EXTERNAL_LINK_SHIM__'

/**
 * 从事件路径里取第一个带 href 的锚点，返回它**原始**的 href（`getAttribute('href')`，
 * 不是解析后的绝对地址）：不对外链的锚点回 null（此时整条兜底什么都不做）。
 */
function allowedExternalHref(path: readonly EventTarget[]): string | null {
  for (const node of path) {
    if (!(node instanceof Element)) continue
    if (node.tagName.toLowerCase() !== 'a') continue
    const href = node.getAttribute('href')
    if (href === null) continue
    return parseAllowedUrl(href)
  }
  return null
}

/**
 * 装一层捕获阶段的文档级点击兜底；返回卸载函数（给 cordis `ctx.effect` 当清理用）。
 * 页面里已经有这一层时不再装第二层（返回空操作）。
 */
export function installExternalLinkShim(): () => void {
  const marked = globalThis as { [INSTALLED_FLAG]?: boolean }
  // 只在 webview 里装（判据见文件头）：普通浏览器 / 官方 web 页里锚点自己就能开。
  if (typeof (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi !== 'function') return () => {}
  if (marked[INSTALLED_FLAG] === true) return () => {}
  const capabilities = hostCapabilities()
  const onClick = (event: MouseEvent): void => {
    // 只认用户真的点出来的事件（VS Code 那层拦截开头也是这条判据）：程序化
    // `a.click()` 今天在 VS Code 里同样打不开外链，兜底不改这件事。
    if (event.isTrusted !== true) return
    const url = allowedExternalHref(event.composedPath())
    if (url === null) return
    event.preventDefault()
    // 见文件头「命中后为什么要 stopPropagation()」：不让 VS Code 那层再开一次。
    event.stopPropagation()
    void capabilities.openExternal(url).catch((error: unknown) => {
      console.warn('[dsh-one] external link could not be opened:', error)
    })
  }
  document.addEventListener('click', onClick, true)
  marked[INSTALLED_FLAG] = true
  return () => {
    document.removeEventListener('click', onClick, true)
    marked[INSTALLED_FLAG] = false
  }
}
