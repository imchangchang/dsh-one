/**
 * Composer 的 Lexical 编辑器封装（#41）。
 *
 * 把旧的「透明 textarea + .ref-token-layer 叠加层」换成 Lexical 纯文本编辑器：
 *  - @token 用 {@link RefTokenNode}（TextNode 子类）在真实文本流里高亮，
 *    不再靠叠加层画点；hover 高亮态由 DOM `data-mention` 联动附件 chip。
 *  - 文本读写都走编辑器（getText / setText / insertTextAtCaret / insertTokenAtCaret /
 *    replaceRange）。@token 的 canonical mention 直接存在节点上，发送时由外层
 *    expandMentionBindings 展开（与旧行为一致）。
 *  - 纯文本行为（粘贴/删除/方向键/Enter 换行）由 @lexical/plain-text 的
 *    registerPlainText 提供；undo/redo 由 @lexical/history 提供。
 *
 * 文本偏移统一在「Lexical 节点空间」内计算（块间用 `\n` 分隔），与 getText()
 * 同源，避免块级 DOM 与纯文本的错位。本模块只提供 composer 编辑器封装，不碰
 * 消息流渲染。
 */
import {
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  PASTE_COMMAND,
  UNDO_COMMAND,
  ElementNode,
  TextNode,
  $applyNodeReplacement,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
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
  /** 纯文本（块间以 \n 分隔；@token 为其显示文本）。 */
  getText: () => string
  /** 用纯文本 + mentionBindings 重建内容（@token 还原为高亮节点）。 */
  setText: (text: string, bindings?: MentionBindings) => void
  /** 在光标处插入普通文本（含 \n 拆行为换行）。 */
  insertTextAtCaret: (text: string) => void
  /** 在光标处插入一个 @token 高亮节点，并补一个空格。 */
  insertTokenAtCaret: (text: string, mention: string) => void
  /** 把纯文本区间 [start, end] 替换为给定文本（光标落到末尾）。 */
  replaceRange: (start: number, end: number, text: string) => void
  /** 当前光标/选区（纯文本偏移）。 */
  selection: () => { start: number; end: number }
  /** 设置光标/选区到纯文本偏移（end 缺省 = start），并聚焦编辑器。 */
  setSelection: (start: number, end?: number) => void
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
    if (this.__mention) dom.setAttribute('data-path', this.__mention)
    return dom
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const changed = super.updateDOM(prevNode, dom, config)
    if (this.__mention) dom.setAttribute('data-path', this.__mention)
    else dom.removeAttribute('data-path')
    return changed
  }
}

function $createRefTokenNode(text: string, mention?: string): RefTokenNode {
  const node = $applyNodeReplacement(new RefTokenNode(text))
  node.__mention = mention
  return node
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

/** 编辑器当前 RangeSelection 的 anchor/focus（保证是区间选区）。 */
function readSelection(editor: LexicalEditor): { anchor: { key: NodeKey; offset: number; type: 'text' | 'element' }; focus: { key: NodeKey; offset: number; type: 'text' | 'element' } } | null {
  let out: { anchor: { key: NodeKey; offset: number; type: 'text' | 'element' }; focus: { key: NodeKey; offset: number; type: 'text' | 'element' } } | null = null
  editor.getEditorState().read(() => {
    const sel = $getSelection()
    if (sel && $isRangeSelection(sel)) {
      out = { anchor: { key: sel.anchor.key, offset: sel.anchor.offset, type: sel.anchor.type }, focus: { key: sel.focus.key, offset: sel.focus.offset, type: sel.focus.type } }
    }
  })
  return out
}

/** 把 point（{key,offset,type}）映射为纯文本偏移（块间 `\n`，与 readPlainText 同源）。 */
function pointToPlainOffset(point: { key: NodeKey; offset: number; type: 'text' | 'element' }): number {
  const node = $getNodeByKey(point.key)
  if (!node) return 0
  let block: ElementNode | null = null
  if (node instanceof TextNode) block = node.getParent()
  else if (node instanceof ElementNode) block = node
  if (!block) return 0
  const blocks = $getRoot().getChildren()
  const blockIndex = blocks.indexOf(block)
  if (blockIndex < 0) return 0
  let offset = 0
  for (let i = 0; i < blockIndex; i++) offset += blocks[i].getTextContent().length + 1
  const sibs = block.getChildren()
  const nodeIndex = sibs.indexOf(node)
  for (let i = 0; i < nodeIndex; i++) offset += sibs[i].getTextContent().length
  if (node instanceof TextNode) offset += node.getTextContent().slice(0, point.offset).length
  else for (let i = 0; i < Math.min(point.offset, sibs.length); i++) offset += sibs[i].getTextContent().length
  return offset
}

/** 把纯文本 offset 映射为 point（Lexical 空间）。 */
function plainOffsetToPoint(offset: number): { key: NodeKey; offset: number; type: 'text' | 'element' } {
  const blocks = $getRoot().getChildren() as ElementNode[]
  let remaining = Math.max(0, offset)
  for (const block of blocks) {
    const sibs = block.getChildren()
    for (let i = 0; i < sibs.length; i++) {
      const child = sibs[i]
      const len = child.getTextContent().length
      if (remaining <= len) {
        if (child instanceof TextNode) return { key: child.getKey(), offset: remaining, type: 'text' }
        return { key: block.getKey(), offset: i, type: 'element' }
      }
      remaining -= len
    }
    remaining -= 1
    if (remaining < 0) return { key: block.getKey(), offset: sibs.length, type: 'element' }
  }
  const last = blocks[blocks.length - 1] ?? $getRoot()
  if (last instanceof TextNode) return { key: last.getKey(), offset: last.getTextContent().length, type: 'text' }
  return { key: last.getKey(), offset: (last as ElementNode).getChildren().length, type: 'element' }
}

/** 查找 DOM 目标对应的 @token mention（hover 联动用）。 */
function mentionFromDom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const span = target.closest<HTMLElement>('.ref-token')
  if (span) return span.getAttribute('data-path')
  return null
}

/**
 * 创建 composer 编辑器。调用方把 `root` 挂进 `.composer-frame`，并把 `placeholder`
 * 一起放进去（占位符绝对定位在 frame 内）。
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

  const selection = (): { start: number; end: number } => {
    const sel = readSelection(editor)
    if (!sel) {
      const text = getText()
      return { start: text.length, end: text.length }
    }
    return { start: pointToPlainOffset(sel.anchor), end: pointToPlainOffset(sel.focus) }
  }

  const setSelection = (start: number, end = start): void => {
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      root.focus()
    })
  }

  const beforeCaret = (): string => {
    const { start } = selection()
    return getText().slice(0, start)
  }

  const afterCaret = (): string => {
    const { end } = selection()
    return getText().slice(end)
  }

  const resolveTextOffsets = (start: number, end: number): { s: { key: NodeKey; offset: number; type: 'text' | 'element' }; e: { key: NodeKey; offset: number; type: 'text' | 'element' } } => {
    let s = { key: '' as NodeKey, offset: 0, type: 'text' } as { key: NodeKey; offset: number; type: 'text' | 'element' }
    let e = { key: '' as NodeKey, offset: 0, type: 'text' } as { key: NodeKey; offset: number; type: 'text' | 'element' }
    editor.getEditorState().read(() => {
      s = plainOffsetToPoint(start)
      e = plainOffsetToPoint(end)
    })
    return { s, e }
  }

  const focus = (atEnd = false): void => {
    root.focus()
    if (atEnd) {
      editor.update(() => $getRoot().selectEnd())
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
        sel.insertText(' ')
      } else {
        let last = $getRoot().getLastChild()
        if (!(last instanceof ElementNode)) {
          last = $createParagraphNode()
          $getRoot().append(last)
        }
        ;(last as ElementNode).append(token)
        $getRoot().selectEnd()
      }
    })
  }

  const replaceRange = (start: number, end: number, text: string): void => {
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      sel.insertText(text)
    })
  }

  const setText = (text: string, newBindings?: MentionBindings): void => {
    if (newBindings) bindings = newBindings
    editor.update(
      () => {
        const rootNode = $getRoot()
        for (const child of [...rootNode.getChildren()]) child.remove()
        for (const line of text.split('\n')) {
          const p = $createParagraphNode()
          for (const seg of splitLineByTokens(line, bindings)) {
            if (!seg.text) continue
            if (seg.token) p.append($createRefTokenNode(seg.text, bindings.get(seg.text)))
            else p.append($createTextNode(seg.text))
          }
          rootNode.append(p)
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
    const sel = selection()
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
        // Shift+Enter / IME 组合中确认候选：不发送，交回 registerPlainText（换行/组合）。
        if (event?.shiftKey || event?.isComposing) return false
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
        if (event.isComposing) return false
        const consumed = handlers.onArrowUp()
        if (consumed) event?.preventDefault()
        return consumed
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<KeyboardEvent>(
      KEY_ESCAPE_COMMAND,
      (event) => {
        // IME 组合中的 Esc 关候选窗，不触发 recall-cancel/清空。
        if (event.isComposing) return false
        const consumed = handlers.onEscape()
        if (consumed) event?.preventDefault()
        return consumed
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<void>(UNDO_COMMAND, () => handlers.onUndoRestore(), COMMAND_PRIORITY_HIGH),
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
    setSelection,
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
