/**
 * Composer 的 Lexical 编辑器封装（#41）。
 *
 * 把旧的「透明 textarea + .ref-token-layer 叠加层」换成 Lexical 纯文本编辑器：
 *  - @token 用 {@link RefTokenNode}（TextNode 子类）在真实文本流里高亮，
 *    不再靠叠加层画点；hover 高亮态由 DOM `data-mention` 联动附件 chip。
 *  - 文本读写都走编辑器（getText / setText / insertAtCaret / insertTokenAtCaret）。
 *    每个 @token 的 canonical mention 直接存在节点上（发送时由外层
 *    expandMentionBindings 展开，与旧行为一致）。
 *  - 纯文本行为（粘贴/删除/方向键/Enter 换行）由 @lexical/plain-text 的
 *    registerPlainText 提供；undo/redo 由 @lexical/history 提供。
 *
 * 本模块只提供 composer 编辑器这一块的封装与节点，不碰消息流渲染。
 */
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  UNDO_COMMAND,
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  ElementNode,
  TextNode,
  createEditor,
  mergeRegister,
  type EditorConfig,
  type LexicalEditor,
  type NodeKey,
  type PasteCommandType,
} from 'lexical'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { registerPlainText } from '@lexical/plain-text'
import { boundTokenRanges } from '../../pure/tokenScan.ts'

/** @token 显示文本（如 `@img.png` / `@标题`）→ canonical mention。 */
export type MentionBindings = Map<string, string>

/** composer 编辑器会触发、交给外层处理的事件回调。 */
export interface ComposerHandlers {
  /** 文本内容变化（含程序化 setText）——外层据此同步按钮/清空/draft。 */
  onTextChange: (text: string) => void
  /** 光标/选区变化——外层据此刷新 @ / slash 补全弹层。 */
  onSelectionChange: () => void
  /** Enter（非 shift、非组合）：返回是否消费（发送）。steer = ⌘/Ctrl。 */
  onEnter: (steer: boolean) => boolean
  /** 光标在首行无选区时的 ↑ 召回：返回是否消费。 */
  onArrowUp: () => boolean
  /** Esc：返回是否消费（清空/停止 turn 由外层裁决）。 */
  onEscape: () => boolean
  /** Ctrl/Cmd+Z：返回是否消费（反悔恢复清空内容）。 */
  onUndoRestore: () => boolean
  /** paste：返回 true 表示已消费（外层已处理）。 */
  onPaste: (event: ClipboardEvent) => boolean
  /** 鼠标移出某个 @token（null = 无 token）——外层联动附件 chip 高亮。 */
  onTokenHover: (mention: string | null) => void
}

/** 编辑器对外暴露的操作面（供 webview.ts 的 composer 逻辑使用）。 */
export interface ComposerEditor {
  /** 挂载点（contentEditable），样式类 `.lexical-input`。 */
  root: HTMLElement
  /** 底层 Lexical 编辑器。 */
  editor: LexicalEditor
  /** 占位符层（内容为空时显示）。 */
  placeholder: HTMLElement
  /** 纯文本（段落间以 \n 分隔；@token 为其显示文本）。 */
  getText: () => string
  /** 用纯文本 + mentionBindings 重建内容（@token 还原为高亮节点）。 */
  setText: (text: string, bindings?: MentionBindings) => void
  /** 在光标处插入普通文本（含 \n 拆行）。 */
  insertTextAtCaret: (text: string) => void
  /** 在光标处插入一个 @token 高亮节点（mention 记在节点上）。 */
  insertTokenAtCaret: (text: string, mention: string) => void
  /** 把纯文本偏移 [start, end] 替换为给定文本。 */
  replaceRange: (start: number, end: number, text: string) => void
  /** 当前光标/选区（按纯文本偏移）。 */
  selection: () => { start: number; end: number }
  /** 光标前的纯文本（@ 补全触发词用）。 */
  beforeCaret: () => string
  /** 光标后的纯文本。 */
  afterCaret: () => string
  /** 聚焦编辑器；可选把光标放到末尾。 */
  focus: (atEnd?: boolean) => void
  /** 释放编辑器。 */
  dispose: () => void
}

const REF_TYPE = 'ref-token'

/** @token 高亮节点：TextNode 子类，文本真实流动（高亮 + 原子删除）。 */
export class RefTokenNode extends TextNode {
  $config() {
    return this.config(REF_TYPE, { extends: TextNode })
  }

  __mention: string | undefined

  constructor(text = '', key?: NodeKey) {
    super(text, key)
    // 原子删除：backspace 一次删整个 token（对齐旧 tokenDeletion）。
    this.setMode('token')
  }

  afterCloneFrom(prevNode: this) {
    super.afterCloneFrom(prevNode)
    this.__mention = (prevNode as RefTokenNode).__mention
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config)
    dom.classList.add('ref-token')
    if (this.__mention) dom.setAttribute('data-mention', this.__mention)
    return dom
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const changed = super.updateDOM(prevNode, dom, config)
    if (this.__mention) dom.setAttribute('data-mention', this.__mention)
    else dom.removeAttribute('data-mention')
    return changed
  }
}

/** 创建 @token 节点。 */
export function $createRefTokenNode(text: string, mention?: string): RefTokenNode {
  const node = $applyNodeReplacement(new RefTokenNode(text))
  node.__mention = mention
  return node
}

export function $isRefTokenNode(node: unknown): node is RefTokenNode {
  return node instanceof RefTokenNode
}

/** 把一行拆成「普通文本 / @token」片段（用于 setText 还原）。 */
function splitLineByTokens(
  line: string,
  bindings?: MentionBindings,
): Array<{ text: string; token: boolean }> {
  if (!bindings || bindings.size === 0) return line ? [{ text: line, token: false }] : []
  const ranges = boundTokenRanges(line, bindings)
  if (ranges.length === 0) return line ? [{ text: line, token: false }] : []
  const out: Array<{ text: string; token: boolean }> = []
  let cursor = 0
  for (const r of ranges) {
    if (r.start > cursor) out.push({ text: line.slice(cursor, r.start), token: false })
    out.push({ text: line.slice(r.start, r.end), token: true })
    cursor = r.end
  }
  if (cursor < line.length) out.push({ text: line.slice(cursor), token: false })
  return out
}

/** 读取编辑器当前纯文本。 */
function readPlainText(editor: LexicalEditor): string {
  let out = ''
  editor.getEditorState().read(() => {
    const parts: string[] = []
    for (const block of $getRoot().getChildren()) {
      parts.push(block.getTextContent())
    }
    out = parts.join('\n')
  })
  return out
}

/** 计算某个 leaf 节点（含偏移）之前在 container 里已出现的文本长度。 */
function textOffsetBefore(container: Node, leaf: Node, offset: number): number {
  const rootDoc = container.ownerDocument ?? document
  const walker = rootDoc.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let accum = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node === leaf) return accum + Math.min(offset, node.textContent?.length ?? 0)
    accum += node.textContent?.length ?? 0
  }
  return accum + Math.min(offset, leaf.textContent?.length ?? 0)
}

/** 计算当前 DOM 选区在编辑器纯文本里的偏移。 */
function selectionOffsets(editor: LexicalEditor): { start: number; end: number } {
  const rootEl = editor.getRootElement()
  if (!rootEl) return { start: 0, end: 0 }
  const dom = rootEl.ownerDocument.defaultView ? rootEl.ownerDocument.getSelection() : null
  if (!dom || dom.rangeCount === 0) {
    const text = readPlainText(editor)
    return { start: text.length, end: text.length }
  }
  const range = dom.getRangeAt(0)
  const start = textOffsetBefore(rootEl, range.startContainer, range.startOffset)
  const end = textOffsetBefore(rootEl, range.endContainer, range.endOffset)
  return { start, end }
}

/** 查找 DOM 目标对应的 @token mention（hover 联动用）。 */
function mentionFromDom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const span = target.closest<HTMLElement>('.ref-token')
  if (span) return span.getAttribute('data-mention')
  return null
}

/**
 * 创建 composer 编辑器。调用方把返回的 `root` 挂进 `.composer-frame`，
 * 并把 `placeholder` 一起放进去（占位符绝对定位在 frame 内）。
 */
export function createComposerEditor(opts: {
  handlers: ComposerHandlers
  placeholderText: string
  editable?: boolean
  bindings?: MentionBindings
}): ComposerEditor {
  const { handlers, placeholderText, editable = true } = opts
  let bindings = opts.bindings ?? new Map<string, string>()

  const editor = createEditor({
    namespace: 'dsh-composer',
    nodes: [RefTokenNode],
    editable,
    onError: (err) => console.error('[composer editor]', err),
  })

  registerPlainText(editor)
  const historyState = createEmptyHistoryState()
  const unregisterHistory = registerHistory(editor, historyState, 1000)

  const root = document.createElement('div')
  root.className = 'lexical-input'
  root.setAttribute('contenteditable', editable ? 'true' : 'false')
  root.setAttribute('role', 'textbox')
  root.setAttribute('aria-multiline', 'true')

  const placeholder = document.createElement('div')
  placeholder.className = 'lexical-placeholder'
  placeholder.textContent = placeholderText

  const getText = (): string => readPlainText(editor)

  const selection = (): { start: number; end: number } => selectionOffsets(editor)

  const beforeCaret = (): string => getText().slice(0, selection().start)
  const afterCaret = (): string => getText().slice(selection().end)

  const focus = (atEnd = false): void => {
    root.focus()
    if (atEnd) {
      editor.update(() => {
        $getRoot().selectEnd()
      })
    }
  }

  const insertTextAtCaret = (text: string): void => {
    editor.update(() => {
      const sel = $getSelection()
      if ($isRangeSelection(sel)) {
        sel.insertText(text)
        return
      }
      const p = $createParagraphNode()
      p.append($createTextNode(text))
      $getRoot().append(p)
    })
  }

  const insertTokenAtCaret = (text: string, mention: string): void => {
    editor.update(() => {
      const sel = $getSelection()
      const token = $createRefTokenNode(text, mention)
      if ($isRangeSelection(sel)) {
        sel.insertNodes([token])
      } else {
        const root = $getRoot()
        let last = root.getLastChild()
        if (!(last instanceof ElementNode)) {
          last = $createParagraphNode()
          root.append(last)
        }
        ;(last as ElementNode).append(token)
      }
      token.insertAfter($createTextNode(' '))
    })
  }

  const replaceRange = (start: number, end: number, text: string): void => {
    editor.update(() => {
      const full = getText()
      const next = full.slice(0, start) + text + full.slice(end)
      writePlainTextInner(editor, next, bindings)
    })
  }

  const setText = (text: string, newBindings?: MentionBindings): void => {
    if (newBindings) bindings = newBindings
    writePlainTextInner(editor, text, bindings)
  }

  function writePlainTextInner(ed: LexicalEditor, text: string, b: MentionBindings): void {
    ed.update(
      () => {
        const r = $getRoot()
        for (const child of [...r.getChildren()]) child.remove()
        for (const line of text.split('\n')) {
          const p = $createParagraphNode()
          for (const seg of splitLineByTokens(line, b)) {
            if (!seg.text) continue
            if (seg.token) {
              const mention = b.get(seg.text)
              p.append($createRefTokenNode(seg.text, mention))
            } else {
              p.append($createTextNode(seg.text))
            }
          }
          r.append(p)
        }
        $getRoot().selectEnd()
      },
      { tag: 'dsh-composer-set' },
    )
  }

  // 编辑器更新 → 同步文本/选区变化（占位符显隐 + 外层自动跟随）。
  let lastText: string | null = null
  let lastSel = { start: -1, end: -1 }
  const unregisterUpdate = editor.registerUpdateListener(() => {
    const text = getText()
    if (text !== lastText) {
      lastText = text
      placeholder.style.display = text.length === 0 ? '' : 'none'
      handlers.onTextChange(text)
    }
    const sel = selectionOffsets(editor)
    if (sel.start !== lastSel.start || sel.end !== lastSel.end) {
      lastSel = sel
      handlers.onSelectionChange()
    }
  })

  // 键盘：Enter 发送 / ↑ 召回 / Esc 清空或停止 / ⌘Z 反悔。
  const unregisterKeys = mergeRegister(
    editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        const steer = !!(event && (event.metaKey || event.ctrlKey))
        const consumed = handlers.onEnter(steer)
        if (consumed) event?.preventDefault()
        return consumed
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<KeyboardEvent>(
      KEY_ARROW_UP_COMMAND,
      (event) => {
        const consumed = handlers.onArrowUp()
        if (consumed) event?.preventDefault()
        return consumed
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<KeyboardEvent>(
      KEY_ESCAPE_COMMAND,
      (event) => {
        const consumed = handlers.onEscape()
        if (consumed) event?.preventDefault()
        return consumed
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<void>(
      UNDO_COMMAND,
      () => handlers.onUndoRestore(),
      COMMAND_PRIORITY_HIGH,
    ),
  )

  // paste：先给外层（sessions/图片/折叠）机会，未消费回落到 registerPlainText。
  const unregisterPaste = editor.registerCommand<PasteCommandType>(
    PASTE_COMMAND,
    (event) => handlers.onPaste(event as unknown as ClipboardEvent),
    COMMAND_PRIORITY_HIGH,
  )

  // hover 联动。
  const onMouseMove = (e: MouseEvent): void => handlers.onTokenHover(mentionFromDom(e.target))
  const onMouseLeave = (): void => handlers.onTokenHover(null)
  root.addEventListener('mousemove', onMouseMove)
  root.addEventListener('mouseleave', onMouseLeave)

  editor.setRootElement(root)

  return {
    root,
    editor,
    placeholder,
    getText,
    setText,
    insertTextAtCaret,
    insertTokenAtCaret,
    replaceRange,
    selection,
    beforeCaret,
    afterCaret,
    focus,
    dispose: () => {
      editor.setRootElement(null)
      unregisterUpdate()
      unregisterKeys()
      unregisterPaste()
      unregisterHistory()
      root.removeEventListener('mousemove', onMouseMove)
      root.removeEventListener('mouseleave', onMouseLeave)
    },
  }
}
