/**
 * Markdown rendering + post-render decoration shared across the chat webview
 * (#40). Extracted from webview.ts so both the legacy webview and future Preact
 * components can import `md`, the DOMPurify sanitize hook, and the decorate*
 * passes without pulling in webview state.
 *
 * The decorate* passes touch webview-owned state (i18n `t`, host `post`, thumbnail
 * caches, commit-info cache, popover/hover machinery, disclosure maps, the full
 * `render()`), so they are produced by `createMarkdownTools(ctx)` with that state
 * injected. Call sites keep their original signatures.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { CONTEXT_BROWSE_ICON, type IconDef } from './icons.ts'
import { el, buttonEl, iconSvg } from './dom.ts'
import { isFilePathHref, isInlineCodeFilePath } from '../../pure/linkPath.ts'
import { inlineImageMediaType } from '../../pure/inlineImage.ts'
import { attachmentBaseName } from '../../pure/composerAttachment.ts'
import { decodeSessionReferenceUri } from '../../pure/sessionMention.ts'
import { codeBlockPreview } from '../../pure/codeBlock.ts'
import { highlightCodeBlock } from './highlight.ts'
import { jsonTreeThresholdExceeded, tryParseJsonTree, type JsonContainer } from '../../pure/jsonTree.ts'
import type { FromWebviewMessage } from '../../pure/chatContract.ts'

marked.setOptions({ gfm: true, breaks: true })

export function md(text: string): string {
  // 默认 URI 白名单之外放行 dsh-session:，mention 链接才能活到 decorate 那步；
  // 文件路径类 href 经下面的 uponSanitizeAttribute 钩子 forceKeep（见钩子注释）。
  return DOMPurify.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|dsh-session):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  })
}

/**
 * 文件路径类 href/src 放行：DOMPurify 的 URI 白名单只认 scheme，绝对/相对路径
 * （/Users/…、docs/foo.md、file:…）会被剥成纯文本，模型写出的文件链接就点不
 * 了。钩子里只对「文件路径形状」的 href/src 设 forceKeepAttr，http(s)/mailto 等
 * 外链与 javascript:/data: 等危险 scheme 不匹配路径形状，仍走默认拦截。
 * img 的 src 同理：内嵌图片的本地路径 src（工具输出 ![img](/a/x.png)）被剥掉就
 * 连「占位后再加载」的入口都没有——decorateMarkdownImages 靠它识别。
 */
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'href' && isFilePathHref(data.attrValue)) {
    data.forceKeepAttr = true
  }
  if (
    data.attrName === 'src' &&
    _node?.nodeName?.toLowerCase() === 'img' &&
    isFilePathHref(data.attrValue)
  ) {
    data.forceKeepAttr = true
  }
})

/** 会话引用图标：dsh web ReferenceIcon 的 session 分支（16x16 聊天气泡 + 两行）。 */
export const SESSION_REF_ICON: IconDef = {
  paths: [
    "M8 0.597656C3.91296 0.597656 0.599716 3.91103 0.599609 7.99805C0.599609 9.13171 0.854567 10.2079 1.31152 11.1699L1.59277 11.7607L2.77441 11.1992L2.49414 10.6084L2.36035 10.3076C2.06865 9.59612 1.90723 8.81645 1.90723 7.99805C1.90733 4.63362 4.63554 1.90625 8 1.90625C11.3644 1.90635 14.0917 4.63368 14.0918 7.99805C14.0918 11.3625 11.3644 14.0907 8 14.0908C7.311 14.0908 6.80642 14.0414 6.35938 13.918C5.919 13.7963 5.50105 13.5929 5.00098 13.2441C4.26805 12.7329 3.21756 12.5526 2.35156 13.0996L2.33789 13.1084L2.32422 13.1182L1.74805 13.5234L2.18164 14.8184L3.05957 14.2002C3.37505 14.0068 3.84248 14.0319 4.25195 14.3174C4.84447 14.7307 5.39718 15.009 6.01172 15.1787C6.61963 15.3465 7.25579 15.3984 8 15.3984C12.087 15.3983 15.4004 12.0851 15.4004 7.99805C15.4003 3.9111 12.087 0.59776 8 0.597656ZM4.56836 8.50977V9.80371H8.12402V8.50977H4.56836ZM4.56836 7.30078H11.4619V6.00684H4.56836V7.30078Z",
  ],
}

/** 消息正文里的 commit hash：7–40 位 hex，两端不能相邻 hex（避免切开长 hex 串/英文词）。 */
const COMMIT_SHA_RE = /(?<![0-9a-fA-F])([0-9a-fA-F]{7,40})(?![0-9a-fA-F])/g

/** Webview-owned state the decorate* passes need, injected via `createMarkdownTools`. */
export interface MarkdownCtx {
  t: (template: string, ...args: Array<string | number | Record<string, unknown>>) => string
  post: (message: FromWebviewMessage) => void
  // decorateMarkdownImages：内嵌图片宿主读盘通道。
  fileThumbCache: Map<string, string>
  fileThumbRequested: Map<string, { at: number; failed: boolean }>
  requestInlineImageIfNeeded: (src: string) => void
  // decorateCommitHashes：commit-info 查询/显示。
  applyCommitHashState: (span: HTMLElement) => void
  noteCommitInfoRequest: (sha: string) => void
  onCommitHashHover: (span: HTMLElement, show: boolean, ev?: MouseEvent) => void
  // enhanceCodeBlocks：折叠/复制反馈/persist 展开态 + 整段 JSON 树。
  render: () => void
  detailsOpen: Map<string, boolean>
  showCopyFeedback: (key: string, showCopied: () => void, restore: () => void) => void
  initCopyFeedback: (key: string, showCopied: () => void, restore: () => void) => void
  renderJsonTree: (value: JsonContainer, outputKey: string) => HTMLElement
}

export interface MarkdownTools {
  decorateSessionMentions: (container: HTMLElement) => void
  decorateMarkdownImages: (container: HTMLElement) => void
  decorateCommitHashes: (container: HTMLElement) => void
  decorateInlineCodes: (container: HTMLElement) => void
  enhanceCodeBlocks: (container: HTMLElement, prefix: string) => void
  /** Shared with webview.ts (user-bubble session chips / inline-image failure chip). */
  sessionMentionChip: (label: string, sessionId: string) => HTMLElement
  markdownImageFailedChip: (src: string, name: string) => HTMLElement
}

/** Build the markdown decorate tools bound to webview state. */
export function createMarkdownTools(ctx: MarkdownCtx): MarkdownTools {
  const {
    t,
    post,
    fileThumbCache,
    fileThumbRequested,
    requestInlineImageIfNeeded,
    applyCommitHashState,
    noteCommitInfoRequest,
    onCommitHashHover,
    render,
    detailsOpen,
    showCopyFeedback,
    initCopyFeedback,
    renderJsonTree,
  } = ctx

  /** @会话超链接 chip：图标 + 标题（对齐 dsh web 的 refChip），点击打开被引用的会话。 */
  function sessionMentionChip(label: string, sessionId: string): HTMLElement {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'session-mention'
    chip.title = t('Referenced session {0}, click to open', sessionId)
    chip.appendChild(iconSvg(SESSION_REF_ICON, 14))
    chip.appendChild(el('span', undefined, label))
    chip.addEventListener('click', () => post({ type: 'sessionOpen', sessionId }))
    return chip
  }

  /** 内嵌图片失败态（文件缺失/非图片之外的超限等）：占位 chip，点击在编辑器打开。 */
  function markdownImageFailedChip(src: string, name: string): HTMLElement {
    const chip = el('span', 'md-img-failed ref-chip-link')
    chip.title = src
    chip.setAttribute('role', 'button')
    chip.tabIndex = 0
    chip.appendChild(iconSvg(CONTEXT_BROWSE_ICON, 14))
    chip.appendChild(el('span', 'md-img-failed-name', name))
    chip.appendChild(el('span', 'md-img-failed-hint', t('Open image in editor')))
    const open = (): void => post({ type: 'openPath', path: src })
    chip.addEventListener('click', open)
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    })
    return chip
  }

  /**
   * 一个代码块主体（<pre><code>，文本走 textContent 防注入）。
   *
   * 语法高亮懒着来：这里只登记「语言 + 文本」，等这块滚进视口才去拉 shiki 资源
   * 并着色（见 highlight.ts）——聊天里翻历史时大部分代码块根本不进视口。
   */
  function mdCodeBody(text: string, lang?: string): HTMLPreElement {
    const pre = el('pre') as HTMLPreElement
    const code = el('code')
    code.textContent = text
    if (lang) code.classList.add(`language-${lang}`)
    pre.appendChild(code)
    highlightCodeBlock(code, lang, text)
    return pre
  }

  /** 认出的 commit hash 换成可点击 span（悬停 title 由缓存状态定，点击走 commitOpen）。 */
  function commitHashEl(sha: string): HTMLElement {
    const span = el('span', 'commit-hash')
    span.dataset.sha = sha
    span.textContent = sha
    span.setAttribute('role', 'button')
    span.tabIndex = 0
    span.addEventListener('click', () => post({ type: 'commitOpen', sha }))
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        post({ type: 'commitOpen', sha })
      }
    })
    span.addEventListener('mouseenter', () => onCommitHashHover(span, true))
    span.addEventListener('mouseleave', (e) => onCommitHashHover(span, false, e))
    applyCommitHashState(span)
    noteCommitInfoRequest(sha)
    return span
  }

  /** md 块渲染后，把 mention 链接（@[label](dsh-session:...)）换成可点击 chip。 */
  function decorateSessionMentions(container: HTMLElement): void {
    container.querySelectorAll<HTMLAnchorElement>('a[href^="dsh-session:"]').forEach((a) => {
      const sessionId = decodeSessionReferenceUri(a.getAttribute('href') ?? '')
      if (!sessionId) return // 坏 URI 保持原样
      a.replaceWith(sessionMentionChip(a.textContent ?? sessionId, sessionId))
    })
  }

  /**
   * md 块渲染后处理内嵌的本地路径图片（read_image 工具输出 ![img](/abs/x.png)）：
   * CSP 只放行 img-src data:，本地路径 src 永远加载失败，走宿主读盘通道
   * （requestInlineImage → fileThumb 回执 → fileThumbCache，布局与文件 chip 同构）。
   * 本 pass 每帧执行：无缓存 → 占位 + 发起请求；缓存命中 → 真图；宿主失败回执
   * （缺失/超限）→ 失败 chip（点击在编辑器打开）。data:（CSP 已放行）与
   * http(s)（维持「不可加载」现状，不走远程）不处理。
   */
  function decorateMarkdownImages(container: HTMLElement): void {
    container.querySelectorAll<HTMLImageElement>('img[src]').forEach((img) => {
      const src = img.getAttribute('src') ?? ''
      if (src.startsWith('data:') || !isFilePathHref(src)) return
      // 扩展名白名单以外的 src 不动（broken 态保持现状），也不发请求
      // ——避免对任意 markdown 路径每 5 秒砸一次 host（纯逻辑见 pure/inlineImage.ts）。
      if (!inlineImageMediaType(src)) return
      const dataUrl = fileThumbCache.get(src)
      if (dataUrl) {
        img.classList.add('md-img-inline')
        img.src = dataUrl
        return
      }
      if (fileThumbRequested.get(src)?.failed) {
        const name = img.alt || attachmentBaseName(src)
        img.replaceWith(markdownImageFailedChip(src, name))
        return
      }
      const ph = el('span', 'md-img-inline md-img-loading', t('Loading image…'))
      ph.title = src
      ph.dataset.mdimgSrc = src
      ph.dataset.mdimgAlt = img.alt
      img.replaceWith(ph)
      requestInlineImageIfNeeded(src)
    })
  }

  /**
   * md 块渲染后扫描正文文本节点里的 commit hash 并替换为可点击 span。跳过代码块
   * （pre）与链接文本——hash 作为代码块/链接内容时不联动；行内 code（反引号包裹）
   * 里的 hash 也联动（用户反馈：markdown 表格/行内码里的 commit hash 期望可点）。
   */
  function decorateCommitHashes(container: HTMLElement): void {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement
        if (!parent) return NodeFilter.FILTER_REJECT
        // 只跳过 pre（围栏/工具输出）与 a（链接文本）；行内 <code> 允许联动，
        // hash 替换为 span 后 textContent 保持原样，不影响行内码外观。
        if (parent.closest('pre, a')) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const textNodes: Text[] = []
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text)
    for (const node of textNodes) {
      const value = node.nodeValue ?? ''
      COMMIT_SHA_RE.lastIndex = 0
      if (!COMMIT_SHA_RE.test(value)) continue
      const frag = document.createDocumentFragment()
      let last = 0
      COMMIT_SHA_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = COMMIT_SHA_RE.exec(value)) !== null) {
        if (m.index > last) frag.appendChild(document.createTextNode(value.slice(last, m.index)))
        frag.appendChild(commitHashEl(m[0]))
        last = m.index + m[0].length
      }
      if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)))
      node.parentNode?.replaceChild(frag, node)
    }
  }

  /**
   * md 块渲染后给行内 code（反引号）补交互（用户反馈：正文反引号路径不可点、复制
   * 要靠鼠标选中，繁琐）：
   * - 内容形如文件路径（isInlineCodeFilePath）→ 可点击直接打开（post openPath，
   *   宿主按附着会话 cwd 解析），hover 下划线 + title 提示；
   * - 复制走右键菜单（见上方 contextmenu 监听）：hover 高亮 + 右键「复制这段」，
   *   替换初版悬浮复制按钮（用户实测反馈：按钮小且悬空、鼠标滑过去 hover 断）。
   * 跳过块级 code（pre 内，已有代码块复制按钮）与链接内 code（点链接即打开）。
   * 流式下每次整块重建，装饰无状态。
   */
  function decorateInlineCodes(container: HTMLElement): void {
    container.querySelectorAll<HTMLElement>('code').forEach((code) => {
      if (code.closest('pre, a') || code.dataset.inlineCode) return
      const text = (code.textContent ?? '').trim()
      if (!text) return
      code.dataset.inlineCode = '1'
      code.classList.add('inline-code')
      const isPath = isInlineCodeFilePath(text)
      if (isPath) code.classList.add('inline-code-path')
      if (isPath) {
        code.title = t('Open in VS Code')
        code.setAttribute('role', 'button')
        code.tabIndex = 0
        const open = (): void => post({ type: 'openPath', path: text })
        code.addEventListener('click', open)
        code.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        })
      }
    })
  }

  /**
   * md 渲染后给每个代码块加复制按钮 + 行数折叠（对齐 dsh web，阈值见
   * src/pure/codeBlock.ts 的 CODE_BLOCK_MAX_LINES）：超过阈值行时折叠成
   * 「头部 + … 其余 N 行 + 尾部」，点击展开全部、再点收起；展开态记在
   * detailsOpen（key 按消息/块位置，流式重建不冲掉，同 detailsEl 的持久化
   * 机制）。复制用 navigator.clipboard，成功短暂显示「已复制」，失败改 title
   * 提示。
   */
  function enhanceCodeBlocks(container: HTMLElement, prefix: string): void {
    container.querySelectorAll<HTMLPreElement>('pre > code').forEach((code, i) => {
      const pre = code.parentElement as HTMLPreElement
      const text = code.textContent ?? ''
      const key = `${prefix}:code:${i}`
      // 代码块内容恰为整段 JSON → 渲染 JsonTree（复用工具输出的树容器：自带右上角
      // 整树复制按钮、展开态持久化在 jsonTreeOpen）。此时不再套 md-code-bar / 「其余 N
      // 行」折叠——树本身用节点展开/收起控制空间，避免同一段 JSON 两个复制按钮。
      const treeValue = tryParseJsonTree(text)
      // JSON 块：不超过行数阈值渲染成树；超过阈值回退到原 code block（本函数下面的
      // 折叠 + code block 复制按钮兜底，避免超大 JSON 树渲染巨量 DOM 行）。
      if (treeValue && !jsonTreeThresholdExceeded(treeValue)) {
        pre.replaceWith(renderJsonTree(treeValue, key))
        return
      }
      const { head, tail, hidden } = codeBlockPreview(text)
      const open = detailsOpen.get(key) ?? false
      const lang = Array.from(code.classList)
        .find((c) => c.startsWith('language-'))
        ?.slice('language-'.length)

      // 头部条：语言标签（有才显示）+ 复制按钮（始终复制全文，不限折叠态）。
      const bar = el('div', 'md-code-bar')
      if (lang) bar.appendChild(el('span', 'md-code-lang', lang))
      const copy = buttonEl('md-code-copy', t('Copy'))
      copy.title = t('Copy code')
      const showCopied = () => {
        copy.textContent = t('Copied')
        copy.title = t('Copied')
      }
      const restore = () => {
        copy.textContent = t('Copy')
        copy.title = t('Copy code')
      }
      copy.addEventListener('click', () => {
        if (!text) return
        void navigator.clipboard.writeText(text).then(
          () => showCopyFeedback(key, showCopied, restore),
          () => {
            copy.title = t('Copy failed')
          },
        )
      })
      initCopyFeedback(key, showCopied, restore)
      bar.appendChild(copy)

      // 折叠/展开按钮：折叠态给「… 其余 N 行」，展开态给「收起」。
      const toggle = (collapsed: boolean, label: string): HTMLButtonElement => {
        const b = buttonEl('md-code-toggle', label)
        b.setAttribute('aria-expanded', String(!collapsed))
        b.setAttribute('aria-label', collapsed ? t('Expand {0} more lines', hidden) : t('Collapse'))
        b.addEventListener('click', () => {
          detailsOpen.set(key, !collapsed)
          render()
        })
        return b
      }

      const wrap = el('div', 'md-code')
      wrap.appendChild(bar)
      // 折叠态的头/尾各自是一个完整 <pre>，语法高亮按「每块各自着色」处理：边界
      // 那一两行的分词可能与展开态略有出入，展开即回到整段着色。
      if (hidden === 0 || open) {
        wrap.appendChild(mdCodeBody(text, lang))
        if (hidden > 0) wrap.appendChild(toggle(false, t('Collapse')))
      } else {
        wrap.appendChild(mdCodeBody(head.join('\n'), lang))
        wrap.appendChild(toggle(true, t('… {0} more lines', hidden)))
        wrap.appendChild(mdCodeBody(tail.join('\n'), lang))
      }
      pre.replaceWith(wrap)
    })
  }

  return {
    decorateSessionMentions,
    decorateMarkdownImages,
    decorateCommitHashes,
    decorateInlineCodes,
    enhanceCodeBlocks,
    sessionMentionChip,
    markdownImageFailedChip,
  }
}
