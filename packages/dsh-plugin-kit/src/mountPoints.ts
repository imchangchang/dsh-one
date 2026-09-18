/**
 * 可移植挂载点（#83）：自有插件「在哪儿听事件、扫哪块正文」的唯一来源。
 *
 * AGENTS.md「能移植的必须移植」要求插件在没有我们的 shell frame 的**官方 web**
 * 里也能用，所以挂载点一律取自**官方语义属性**，不认任何自有标记（原先三个插件
 * 挂在 `[data-shell="dsh-one"]` 上，取不到就整个不工作——官方 web 里正是这样）：
 *
 * - **对话区容器** = `[data-conversation-scroll]`：官方 `ui-conversation` 的会话
 *   滚动体（出处 `dsh-client-ui-conversation/lib/client.js` 的 ConversationRoot：
 *   `body > scrollBody[data-conversation-scroll] > [conversation.session 槽位,
 *   composerSeat]`——**会话流与 composer 都在这棵子树里**，所以三个插件共用它）。
 *   官方自己也用它当「对话区」的界：`ui-chat` 的 ChatView 里
 *   `scrollerOf(from) = from.closest("[data-conversation-scroll]") ?? from`，CSS 里
 *   也按它切「有独立滚动体」的档（`[data-conversation-scroll] .EvIC1a_root{...}`）。
 * - **composer 槽位** = `[data-slot="conversation.composer.bar"]`：官方槽位渲染出的
 *   语义属性（语言无关、非 css-module 哈希），判断按键是否落在输入区内用。
 *
 * 走第几层机制：这两条都是**官方语义属性**（层 1 官方槽位机制渲染出的稳定结构、
 * 官方组件写进 DOM 的语义标记），不是 CSS 兜底——本模块不写一行样式，也不用任何
 * 官方 css-module 哈希类名。
 *
 * ## 为什么是「订阅容器」而不是启动时取一次
 * 官方组件异步挂载：插件 apply（以及它注册的层组件首次渲染）都可能早于
 * ui-conversation 把容器渲染出来；容器被整棵换掉（官方重挂根组件）时旧引用也会
 * 变成死节点。两种情况都只在真运行里才暴露，所以这里等它出现再挂、换掉再重挂。
 *
 * 本模块与同包的 hostCapabilities.ts / hostClient.ts 同住私有包
 * `@dsh-one/dsh-plugin-kit`（#94）：源码一份，构建期由各插件自己的 bundle 各打
 * 一份进去（各插件是独立 bundle，没有共享模块作用域）。
 */

/** 官方对话区容器（会话流 + composer 所在的滚动体）。 */
export const CONVERSATION_SCROLL_SELECTOR = '[data-conversation-scroll]'

/** 官方 composer 槽位（判断按键目标是否落在输入区内）。 */
export const COMPOSER_SEAT_SELECTOR = '[data-slot="conversation.composer.bar"]'

/** 当前页面上的官方对话区容器（没有时 null）。 */
export function conversationContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CONVERSATION_SCROLL_SELECTOR)
}

/**
 * 把一段装配挂到官方对话区容器上（事件委托 / 正文扫描）。
 *
 * @param attach - 装到该容器上，返回拆装函数（容器离开或被替换时调用）。
 * @returns 整体撤销函数。
 */
export function mountOnConversation(attach: (container: HTMLElement) => () => void): () => void {
  let container: HTMLElement | null = null
  let detach: (() => void) | null = null

  const sync = (): void => {
    // 已挂上且容器还在文档里 = 什么都没变（每次 DOM 变更都查一遍选择器太贵）。
    if (container !== null && container.isConnected) return
    detach?.()
    detach = null
    container = conversationContainer()
    if (container !== null) detach = attach(container)
  }

  const observer = new MutationObserver(sync)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  sync()
  return () => {
    observer.disconnect()
    detach?.()
    detach = null
    container = null
  }
}

/**
 * 绝对定位元素的**坐标系**：最近的「可定位祖先盒」——该元素 `position:absolute`
 * 时 CSS 实际参照的那个盒子。跳过 `display:contents` 的包装层（官方槽位给每个
 * 条目套一层 display:contents 包装：它不生成盒子、也不是包含块）。
 *
 * 这样同一份定位代码在自有 shell 的 overlay 里与官方外框的 overlay 里都对，
 * 不需要认识任何自有标记；一个可定位祖先都没有时按初始包含块（文档元素）算。
 */
export function positioningContext(element: HTMLElement): HTMLElement {
  let current = element.parentElement
  while (current !== null) {
    const style = getComputedStyle(current)
    if (style.position !== 'static' && style.display !== 'contents') return current
    current = current.parentElement
  }
  return document.documentElement
}
