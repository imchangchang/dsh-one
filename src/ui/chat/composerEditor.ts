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
  DecoratorNode,
  ElementNode,
  TextNode,
  $applyNodeReplacement,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isDecoratorNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  createEditor,
  mergeRegister,
  type EditorConfig,
  type LexicalEditor,
  type NodeKey,
  type PasteCommandType,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical'
import { createEmptyHistoryState, registerHistory } from '@lexical/history'
import { registerPlainText } from '@lexical/plain-text'
import { boundTokenRanges, scanAtTokens, shouldColorAtToken } from '../../pure/tokenScan.ts'

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
  insertTokenAtCaret: (text: string, mention: string, appearance?: ChipAppearance) => void
  /** 把纯文本区间 [start, end] 替换为给定文本（光标落到末尾）。 */
  replaceRange: (start: number, end: number, text: string) => void
  /** 把纯文本区间 [start, end] 替换为一个 @token 高亮节点（光标落到末尾）。 */
  replaceTokenRange: (start: number, end: number, text: string, mention: string, appearance?: ChipAppearance) => void
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
const CHIP_TYPE = 'ref-chip'

/** 空候选名集合（atTokenNames 缺省用；不共享可变实例，读到即返回同一个空集）。 */
const EMPTY_NAME_SET: ReadonlySet<string> = new Set<string>()

/** @token 显示文本 → canonical mention（如 `@img.png` → `@/abs/img.png`）。 */
export type ChipAppearance = 'file' | 'folder' | 'session' | 'plain'

/** Serialized 形态（对齐官方 ReferenceChipNode 的 exportJSON：type/version + 字段）。 */
type SerializedRefChipNode = Spread<
  {
    source: string
    ref: string
    label: string
    clipboardText: string
    appearance: ChipAppearance
  },
  SerializedLexicalNode
>

/** 内联文件图标（纯 DOM，不给 DecoratorNode 造 React 依赖）。 */
const FILE_ICON_PATH = 'M4.2 2h4.6L12 5.2V14H4.2z M8.8 2v3.2H12'

/**
 * ReferenceChipNode：原子 chip（选中才算，align 官方 ReferenceChipNode）。
 *
 * 两段式的「落定态」：从补全菜单选中后才替换为它。它是 DecoratorNode：
 *  - {@link isInline}() = true（行内）。
 *  - {@link isKeyboardSelectable}() = false（整块删 + 箭头一步跨，光标不落进 chip）。
 *  - {@link getTextContent}() 返回「剪贴板/文本投影」=`clipboardText`——统一取
 *    「显示 token 文本」（如 `@img.png`），保证 `getText()`/`expandMentionBindings`
 *    的文本语义与单段式一致（chip 在纯文本流里投影为它的显示 token）。
 *  - 纯 DOM（composer 无 React）：visible 内容由 {@link createDOM} 画进宿主元素，
 *    {@link decorate}() 返回 null（基类默认），不再走 React portal。
 */
export class ReferenceChipNode extends DecoratorNode<HTMLElement> {
  $config() {
    return this.config(CHIP_TYPE, { extends: DecoratorNode })
  }

  static clone(node: ReferenceChipNode): ReferenceChipNode {
    return new ReferenceChipNode(
      node.__source,
      node.__ref,
      node.__label,
      node.__clipboardText,
      node.__appearance,
      node.__key,
    )
  }

  __source: string
  __ref: string
  __label: string
  __clipboardText: string
  __appearance: ChipAppearance

  constructor(
    source: string,
    ref: string,
    label: string,
    clipboardText: string,
    appearance: ChipAppearance = 'file',
    key?: NodeKey,
  ) {
    super(key)
    this.__source = source
    this.__ref = ref
    this.__label = label
    this.__clipboardText = clipboardText
    this.__appearance = appearance
  }

  afterCloneFrom(prevNode: this) {
    super.afterCloneFrom(prevNode)
    this.__source = (prevNode as ReferenceChipNode).__source
    this.__ref = (prevNode as ReferenceChipNode).__ref
    this.__label = (prevNode as ReferenceChipNode).__label
    this.__clipboardText = (prevNode as ReferenceChipNode).__clipboardText
    this.__appearance = (prevNode as ReferenceChipNode).__appearance
  }

  exportJSON(): SerializedRefChipNode {
    return {
      ...super.exportJSON(),
      type: CHIP_TYPE,
      version: 1,
      source: this.__source,
      ref: this.__ref,
      label: this.__label,
      clipboardText: this.__clipboardText,
      appearance: this.__appearance,
    }
  }

  static importJSON(json: SerializedRefChipNode): ReferenceChipNode {
    const node = $createRefChipNode(
      json.source,
      json.ref,
      json.label,
      json.clipboardText,
      json.appearance,
    )
    return node
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement('span')
    dom.className = 'ref-chip'
    dom.contentEditable = 'false'
    dom.setAttribute('data-composer-chip', this.__source)
    dom.setAttribute('data-ref', this.__ref)
    // 长路径截断 + tooltip 显示完整 label（原生 title，非展开面板）。官方同款：
    // label 是完整显示文本、纯靠 CSS ellipsis 截断，title=label。
    dom.title = this.__label
    if (this.__appearance === 'file' || this.__appearance === 'folder') {
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      icon.setAttribute('width', '12')
      icon.setAttribute('height', '12')
      icon.setAttribute('viewBox', '0 0 12 14')
      icon.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', FILE_ICON_PATH)
      icon.appendChild(path)
      dom.appendChild(icon)
    } else {
      // appearance 未设 → `@` marker（官方 ReferenceChip 的 marker 兜底）。
      const marker = document.createElement('span')
      marker.className = 'ref-chip-marker'
      marker.textContent = '@'
      marker.setAttribute('aria-hidden', 'true')
      dom.appendChild(marker)
    }
    const textSpan = document.createElement('span')
    textSpan.className = 'ref-chip-label'
    textSpan.textContent = this.__label
    dom.appendChild(textSpan)
    return dom
  }

  updateDOM(prevNode: ReferenceChipNode, dom: HTMLElement, config: EditorConfig): boolean {
    // 宿主形状由标签/路径决定；label 变化时手动刷新 title 与短名。
    const changed = super.updateDOM?.(prevNode, dom, config) ?? false
    if (this.__label !== prevNode.__label || this.__ref !== prevNode.__ref) {
      dom.setAttribute('data-ref', this.__ref)
      dom.title = this.__label
      const textSpan = dom.querySelector('.ref-chip-label')
      if (textSpan) textSpan.textContent = this.__label
      return true
    }
    return changed
  }

  isInline(): boolean {
    return true
  }

  isKeyboardSelectable(): boolean {
    return false
  }

  getTextContent(): string {
    return this.__clipboardText
  }

  // 纯 DOM：不返回 React JSX；内容由 createDOM 画。基类 DecoratorNode 默认返回 null。
  decorate(): null {
    return null
  }
}

export function $createRefChipNode(
  source: string,
  ref: string,
  label: string,
  clipboardText: string,
  appearance: ChipAppearance = 'file',
): ReferenceChipNode {
  return $applyNodeReplacement(new ReferenceChipNode(source, ref, label, clipboardText, appearance))
}

function $isRefChipNode(node: unknown): node is ReferenceChipNode {
  return node instanceof ReferenceChipNode
}

/** @token 高亮节点：TextNode 子类，文本真实流动（可编辑着色，两段式的「后选中前置态」）。 */
export class RefTokenNode extends TextNode {
  $config() {
    return this.config(REF_TYPE, { extends: TextNode })
  }

  __mention: string | undefined

  constructor(text = '', key?: NodeKey) {
    super(text, key)
    // 弃用 token mode：词内可改（官方的 TextRefNode 不整块删，删除/编辑逐字符）。
    // 保留 createDOM 着色，删除原子性只属于 chip。
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

  // 官方 TextRefNode：视为文本实体、允许词前插入（词内可改）。
  isTextEntity(): boolean {
    return true
  }

  canInsertTextBefore(): boolean {
    return true
  }
}

function $createRefTokenNode(text: string, mention?: string): RefTokenNode {
  const node = $applyNodeReplacement(new RefTokenNode(text))
  node.__mention = mention
  return node
}

function $isRefTokenNode(node: unknown): node is RefTokenNode {
  return node instanceof RefTokenNode
}

/**
 * 两段式的「第一段」：把文本流里匹配 @token 边界的词着色为可编辑 TextRefNode，
 * 让「输入中未选定的 @name / @dir/」与「粘贴含 @ 的文本」呈现纯文本着色（无图标）。
 *
 * 仅当片段确实是普通可编辑文本（isSimpleText = 非目标节点、非组合中）时处理——组合
 * 中的 TextNode 会被 registerPlainText 切到分段模式，isSimpleText 为 false，天然跳过。
 * 已着色的 RefTokenNode 的 type 是 'ref-token'（≠'text'），isSimpleText 也为 false，
 * 不会被这里重复处理（官方的 Transform B 语义：已着色的留原地）。
 *
 * 不改文本内容、不产生 chip：chip 只来自菜单选中（replaceTokenRange/insertTokenAtCaret）。
 */
function registerTextRefDecoration(
  editor: LexicalEditor,
  atTokenNames: () => ReadonlySet<string>,
): () => void {
  return editor.registerNodeTransform(TextNode, (node) => {
    if (!node.isSimpleText()) return
    const text = node.getTextContent()
    const ranges = scanAtTokens(text)
    if (ranges.length === 0) return
    const names = atTokenNames()
    // 从后往前拆，避免前面 splitText 使后续 offset 失效。每个命中段单独变成
    // TextRefNode（可编辑着色），其余保持普通文本。跳过只有触发符（`@` 无名）的段——
    // 裸 `@` 是补全触发输入中，不着色（官方 TEXT_REF_RE 要求 `@` 后至少一个 \w-）。
    for (let i = ranges.length - 1; i >= 0; i -= 1) {
      const { start, end, quoted } = ranges[i]
      if (end <= start + 1) continue
      // 词库门控（对齐官方 scanTextRefs）：`@"…"`/`@dir/` 按语法着色，其余
      // `@name` 仅当 name 在 live 候选（@ 补全能触发/能展开的那类引用——附件/
      // 工作区文件/会话短名 + 已登记绑定）里才着色；未知名/半截名（@img、
      // @nonexistent）保持纯文本。名取 `@` 后的整段显示名。
      if (!shouldColorAtToken(text.slice(start, end), quoted, names)) continue
      // 每次变换后 `node` 可能已失效（splitText 会返回新节点），必须重新取当前
      // 最新节点。这里用 getLatest() 保证指向同一逻辑节点在后文中的最新实例。
      const current = node.getLatest()
      const textNow = current.getTextContent()
      if (start >= end || start >= textNow.length) continue
      const split: TextNode[] = current.splitText(start, end)
      const tokenSegment = split[1]
      if (!tokenSegment) continue
      const ref = $createRefTokenNode(tokenSegment.getTextContent())
      tokenSegment.replace(ref)
      // 本轮只处理一个节点的一个命中段；余下命中由下一趟 dirty 驱动处理。
      break
    }
  })
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

/** 把 point（{key,offset,type}）映射为纯文本偏移（块间 `\n`，与 readPlainText 同源）。 */
function pointToPlainOffset(point: { key: NodeKey; offset: number; type: 'text' | 'element' }): number {
  const node = $getNodeByKey(point.key)
  if (!node) return 0
  let block: ElementNode | null = null
  if (node instanceof TextNode) block = node.getParent()
  else if (node instanceof ElementNode) block = node
  // DecoratorNode（chip）是行内原子：绑定到其父块，chip 的文本投影占一整段。
  else if ($isDecoratorNode(node)) block = node.getParent()
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
  else if ($isDecoratorNode(node)) {
    // chip 不可键盘选择、无 `offset`——投影固定在「chip 起点」（前一个兄弟之后）。
    offset += 0
  } else for (let i = 0; i < Math.min(point.offset, sibs.length); i++) offset += sibs[i].getTextContent().length
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
        // 原子 chip（DecoratorNode）：光标落不进 chip，锚到 block 的该 sibling 下标（chip 前缘）。
        if (remaining === len) return { key: block.getKey(), offset: i + 1, type: 'element' }
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

/** 查找 DOM 目标对应的 @token mention（hover 联动用）：chip 存 data-ref，text-ref 存 data-path。 */
function mentionFromDom(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  const chip = target.closest<HTMLElement>('.ref-chip')
  if (chip) return chip.getAttribute('data-ref')
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
  /**
   * 当前 live 的 @ 候选名集合（@ 补全数据：附件/工作区文件/会话短名 + 已登记
   * 绑定的显示名）。每次文本节点变换时调用，返回当前该叫什么名才算「已认识」的
   * @name——词库门控用（对齐官方 scanTextRefs）。缺省为空集（无候选名，@name 不着色）。
   */
  atTokenNames?: () => ReadonlySet<string>
}): ComposerEditor {
  const { handlers, placeholderText, editable = true } = opts
  let bindings = opts.bindings ?? new Map<string, string>()
  const atTokenNames = opts.atTokenNames ?? ((): ReadonlySet<string> => EMPTY_NAME_SET)

  const editor = createEditor({
    namespace: 'dsh-composer',
    nodes: [RefTokenNode, ReferenceChipNode],
    editable,
    onError: (err) => console.error('[composer editor]', err),
  })

  registerPlainText(editor)
  const historyState = createEmptyHistoryState()
  const unregisterHistory = registerHistory(editor, historyState, 1000)
  const unregisterTextRef = registerTextRefDecoration(editor, atTokenNames)

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
    let start = 0
    let end = 0
    editor.getEditorState().read(() => {
      const sel = $getSelection()
      if (sel && $isRangeSelection(sel)) {
        start = pointToPlainOffset(sel.anchor)
        end = pointToPlainOffset(sel.focus)
      } else {
        // 无选区（无 focus）：退化为「光标在末尾」。
        const blocks = $getRoot().getChildren()
        let len = 0
        for (let i = 0; i < blocks.length; i++) {
          len += blocks[i].getTextContent().length + (i > 0 ? 1 : 0)
        }
        start = len
        end = len
      }
    })
    return { start, end }
  }

  const setSelection = (start: number, end = start): void => {
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      root.focus()
    }, { discrete: true })
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
      editor.update(() => $getRoot().selectEnd(), { discrete: true })
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
    }, { discrete: true })
  }

  const insertTokenAtCaret = (text: string, mention: string, appearance: ChipAppearance = 'file'): void => {
    editor.update(() => {
      const sel = $getSelection()
      const token = $createRefChipNode(appearance, mention, text, text, appearance)
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
    }, { discrete: true })
  }

  const replaceRange = (start: number, end: number, text: string): void => {
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      sel.insertText(text)
    }, { discrete: true })
  }

  const replaceTokenRange = (start: number, end: number, text: string, mention: string, appearance: ChipAppearance = 'file'): void => {
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      const token = $createRefChipNode(appearance, mention, text, text, appearance)
      sel.insertNodes([token])
      sel.insertText(' ')
    }, { discrete: true })
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
      { tag: 'dsh-composer-set', discrete: true },
    )
  }

  // 编辑器更新 → 同步文本/选区变化（占位符显隐 + 外层自动跟随）。
  // 注意：必须在 setRootElement(root) 之后注册——挂载首帧的 update 在 setRootElement
  // 内部触发，此时调用方尚未拿到编辑器（外层 composer 未赋值），提前触发 onTextChange
  // 会在调用方闭包里读到未初始化的编辑器（回归：composer 不渲染）。
  let lastText: string | null = null
  let lastSel = { start: -1, end: -1 }

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

  // 挂载完成后再挂更新监听：首帧（setRootElement 内触发的 update）不让 onTextChange
  // 提前触发，后续文本/选区变化才通知外层。
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

  return {
    root,
    editor,
    placeholder,
    getText,
    setText,
    insertTextAtCaret,
    insertTokenAtCaret,
    replaceRange,
    replaceTokenRange,
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
      unregisterTextRef()
      root.removeEventListener('mousemove', onMouseMove)
      root.removeEventListener('mouseleave', onMouseLeave)
    },
  }
}
