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
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  HISTORIC_TAG,
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
import { boundTokenRanges, scanAtTokens, scanCommandTokens, shouldColorAtToken, shouldColorSlashToken } from '../../pure/tokenScan.ts'
import { restoreFileMentionTokens } from '../../pure/fileReference.ts'
import { restoreSessionMentionTokens, sessionMentionRanges } from '../../pure/sessionMention.ts'

/** @token 显示文本（如 `@img.png` / `@标题`）→ canonical mention。 */
export type MentionBindings = Map<string, string>

/** composer 编辑器会触发、交给外层处理的事件回调。 */
export interface ComposerHandlers {
  /**
   * 文本内容变化——外层据此同步按钮/清空/draft。
   * `programmatic` = 这次变化来自 {@link ComposerEditor.setText}（清空/召回/草稿
   * 恢复等程序化重写），不是用户敲进来的新内容；外层据此区分「内容入场」与
   * 「程序自己重写」（清空暂存只被前者作废）。
   */
  onTextChange: (text: string, meta: { programmatic: boolean }) => void
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
  /**
   * 发送用的文本投影：纯文本形态，但**真正的引用节点**投影成 canonical
   * mention——参考 chip 给它的 `ref`，带绑定的 ref-token（补全落定/召回还原）
   * 给它的 `mention`。手打的 `@name` 是普通文本节点，原样保留。
   *
   * 这是「手打 token 不被历史绑定静默改写」的分界：文本级的
   * expandMentionBindings 只看字符串，分不出「选中的引用」和「碰巧同名的手打
   * 文本」；节点级能分（官方同样是 chip 节点 serialize、纯文本不碰）。
   */
  textWithMentions: () => string
  /** 用纯文本 + mentionBindings 重建内容（@token 还原为高亮节点）。 */
  setText: (text: string, bindings?: MentionBindings) => void
  /** 在光标处插入普通文本（含 \n 拆行为换行）。 */
  insertTextAtCaret: (text: string) => void
  /** 在光标处插入一个 @token 高亮节点，并补一个空格。 */
  insertTokenAtCaret: (text: string, mention: string, appearance?: ChipAppearance) => void
  /** 把纯文本区间 [start, end] 替换为给定文本（光标落到末尾）。 */
  replaceRange: (start: number, end: number, text: string) => void
  /**
   * 把纯文本区间 [start, end] 替换为「文本 / 带 mention 的引用」片段序列。
   * 粘会话 mention 用：mention 片段落成 RefTokenNode（带 canonical mention，
   * 发送投影能展开），普通片段走 insertText（含 \n 时照常拆段）。
   */
  replaceRangeWithParts: (start: number, end: number, parts: Array<{ text: string; mention?: string }>) => void
  /** 把纯文本区间 [start, end] 替换为一个 @token 高亮节点（光标落到末尾）。 */
  replaceTokenRange: (start: number, end: number, text: string, mention: string, appearance?: ChipAppearance) => void
  /** 当前光标/选区（纯文本偏移）。 */
  selection: () => { start: number; end: number }
  /**
   * 草稿版本号：每次文本内容变化 +1（对齐官方 shell 的 `rev`）。补全候选在
   * 构建时记下当时的版本，落定时做 CAS——期间草稿被改过就丢弃这次插入，
   * 而不是按过期区间改写文本。
   */
  draftRev: () => number
  /**
   * 是否处于输入法组合期（对齐官方 isComposingEvent）：`event.isComposing`
   * 或 `keyCode === 229`（Safari/旧 WebKit 组合期 keydown 只有 229），
   * 或 `compositionend` 之后 10ms 内（end 与 keydown 同帧到达时 isComposing
   * 已翻假，直接放行会把「确认候选的 Enter」当成发送）。
   */
  blockedByComposition: (event: KeyboardEvent | null) => boolean
  /** 设置光标/选区到纯文本偏移（end 缺省 = start），并聚焦编辑器。 */
  setSelection: (start: number, end?: number) => void
  /** 光标前的纯文本（@ 补全触发词用）。 */
  beforeCaret: () => string
  /** 光标后的纯文本。 */
  afterCaret: () => string
  /** 聚焦编辑器；可选把光标放到末尾。 */
  focus: (atEnd?: boolean) => void
  /**
   * 全量重扫着色（对齐官方 rescanTextRefs）：Lexical 的节点变换只跑在 dirty
   * 节点上，而「词库变了」本身不会弄脏任何节点——新附件/新候选到位时已输入
   * 的 @token 不会自己变亮。调用方在词库集合变化时调它把所有文本节点标脏。
   */
  rescanTextRefs: () => void
  /** 释放编辑器。 */
  dispose: () => void
}

const REF_TYPE = 'ref-token'
const CHIP_TYPE = 'ref-chip'
/** setText 的程序化写入标签：外层据此区分「用户编辑」与「程序化重写」，历史栈据此忽略。 */
const SET_TAG = 'dsh-composer-set'

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
 *  - {@link getTextContent}() 返回「剪贴板/文本投影」=`clipboardText`——**可解析
 *    引用**（`@/abs/foo.ts` / `@[标签](dsh-session:…)`），与官方 ReferenceChipNode
 *    的 clipboardText 同语义（官方注释：clipboard / persistence projection）。
 *    chip 显示的 {@link createDOM} label 只是显示名（`@foo.ts`），不进文本投影：
 *    复制出去、落草稿、跨窗口、重启恢复拿到的都是能直接解析的引用。
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
    // data-path 一律写：有绑定时是 canonical mention，否则就是显示 token——
    // 外层 hover 联动拿它反查 mentionBindings（手打的 token 也能对上附件 chip）。
    dom.setAttribute('data-path', this.__mention ?? this.getTextContent())
    return dom
  }

  updateDOM(prevNode: this, dom: HTMLElement, config: EditorConfig): boolean {
    const changed = super.updateDOM(prevNode, dom, config)
    dom.setAttribute('data-path', this.__mention ?? this.getTextContent())
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
 * 两段式的「第一段」：把文本流里匹配 @token / /command 边界的词着色为可编辑
 * TextRefNode，让「输入中未选定的 @name / @dir/ / /command」与「粘贴含 @ 或 /
 * 的文本」呈现纯文本着色（无图标）。
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
  slashTokenNames: () => ReadonlySet<string>,
): () => void {
  return editor.registerNodeTransform(TextNode, (node) => {
    if (!node.isSimpleText()) return
    const text = node.getTextContent()
    const atRanges = scanAtTokens(text)
    const slashRanges = scanCommandTokens(text)
    if (atRanges.length === 0 && slashRanges.length === 0) return
    const names = atTokenNames()
    const skillNames = slashTokenNames()
    // 从后往前拆，避免前面 splitText 使后续 offset 失效。每个命中段单独变成
    // TextRefNode（可编辑着色），其余保持普通文本。跳过只有触发符（`@` 无名 /
    // 裸 `/`）的段——裸 `@` 是补全触发输入中，不着色（官方 TEXT_REF_RE 要求
    // 触发符后至少一个 \w-）。合并 @ 与 / 两套区间（触发符不同不重叠），先拆
    // 最右的命中段，左侧其余命中留在前段节点里，由下一趟 dirty 驱动处理。
    const candidates: Array<{ start: number; end: number; quoted: boolean; slash: boolean }> = [
      ...atRanges.map((r) => ({ start: r.start, end: r.end, quoted: r.quoted, slash: false })),
      ...slashRanges.map((r) => ({ start: r.start, end: r.end, quoted: false, slash: true })),
    ]
    candidates.sort((a, b) => b.start - a.start || b.end - a.end)
    for (const { start, end, quoted, slash } of candidates) {
      if (end <= start + 1) continue
      // 词库门控（对齐官方 scanTextRefs）：`@"…"`/`@dir/` 按语法着色，其余
      // `@name` 仅当 name 在 live 候选（@ 补全能触发/能展开的那类引用——附件/
      // 工作区文件/会话短名 + 已登记绑定）里才着色；`/command` 仅当命令名在
      // skill 候选（宿主指令名录 + 客户端 /model）里才着色。未知名/半截名
      // （@img、@nonexistent、/foo、\/Users/…）保持纯文本。名取触发符后的整段。
      const tokenText = text.slice(start, end)
      if (slash ? !shouldColorSlashToken(tokenText, skillNames) : !shouldColorAtToken(tokenText, quoted, names)) continue
      // 每次变换后 `node` 可能已失效（splitText 会返回新节点），必须重新取当前
      // 最新节点。这里用 getLatest() 保证指向同一逻辑节点在后文中的最新实例。
      const current = node.getLatest()
      const textNow = current.getTextContent()
      if (start >= end || start >= textNow.length) continue
      // 整节点命中（start=0 且 end=节点全文长度）时 Lexical 的 splitText 返回
      // `[self]`（没有可切的第二段），必须整节点替换——否则「输入框里只有这个
      // token」这一最常见的形态（刚打完 `@dir/`、`@"a b/`）永远不着色。
      const tokens = current.splitText(start, end)
      const tokenSegment = tokens[1]
      if (tokenSegment) tokenSegment.replace($createRefTokenNode(tokenSegment.getTextContent()))
      else if (end === textNow.length) current.replace($createRefTokenNode(textNow))
      else continue
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

/** setText 的片段：plain = 普通文本；chip = canonical 引用（文本投影即可解析路径）；token = 显示 token（着色文本节点）。 */
interface LineSegment {
  /** 片段在文本流里的字面内容（chip 这里是显示名，不是它的文本投影）。 */
  text: string
  kind: 'plain' | 'chip' | 'token'
  /** chip/token 的 canonical mention（进编辑器后作为节点的文本投影）。 */
  mention?: string
}

/**
 * 文本里的 canonical 引用区间：会话 `@[标签](dsh-session:…)` 与路径形
 * `@/abs/…`（含 `@"…"` 引号形）。文本里出现这两类说明内容来自 chip 的文本
 * 投影（复制/落草稿/跨窗口/重启恢复），恢复时要重建回 chip；其余 `@短名` 是
 * 手打/粘贴的显示 token，保持着色文本节点的形态（无分隔符的 @token 不是引用，
 * 见 #36）。
 */
function canonicalMentionRanges(line: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = sessionMentionRanges(line).map((r) => ({
    start: r.start,
    end: r.end,
  }))
  for (const r of scanAtTokens(line)) {
    const cleaned = line.slice(r.start + 1, r.end).replace(/^"|"$/g, '')
    if (/[\\/]/.test(cleaned)) ranges.push({ start: r.start, end: r.end })
  }
  return ranges.sort((a, b) => a.start - b.start)
}

/**
 * canonical mention → chip 显示 label：优先反查已有绑定（上次输入时的显示
 * token 原样回来，含 ` (2)` 后缀），未命中再按短名派生并登记绑定。两个
 * restore* 复用现成的反查/派生规则（与发送展开互逆），无法解析时原样返回。
 */
function displayTokenForMention(mention: string, bindings: MentionBindings): string {
  const session = restoreSessionMentionTokens(mention, bindings)
  if (session !== mention) return session
  const file = restoreFileMentionTokens(mention, bindings)
  if (file !== mention) return file
  return mention
}

/** canonical mention 对应的 chip 外观：会话引用 / 目录（尾斜杠）/ 文件。 */
function chipAppearanceForMention(mention: string): ChipAppearance {
  if (mention.startsWith('@[')) return 'session'
  return /\/"?$/.test(mention) ? 'folder' : 'file'
}

/**
 * 把一行拆成 plain / chip / token 片段（setText 还原用）。canonical 引用先按
 * {@link canonicalMentionRanges} 切出来（这些片段重建为 chip，文本投影保持
 * 可解析），其余部分再按绑定键切显示 token（维持着色文本节点）。
 */
function splitLineByReferences(line: string, bindings: MentionBindings): LineSegment[] {
  const out: LineSegment[] = []
  const pushPlain = (chunk: string): void => {
    for (const seg of splitLineByTokens(chunk, bindings)) {
      out.push({ text: seg.text, kind: seg.token ? 'token' : 'plain', mention: seg.token ? bindings.get(seg.text) : undefined })
    }
  }
  let cursor = 0
  for (const range of canonicalMentionRanges(line)) {
    if (range.start < cursor) continue
    const mention = line.slice(range.start, range.end)
    pushPlain(line.slice(cursor, range.start))
    out.push({ text: displayTokenForMention(mention, bindings), kind: 'chip', mention })
    cursor = range.end
  }
  pushPlain(line.slice(cursor))
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

/**
 * 读取编辑器的「发送投影」：引用节点（chip / 带 mention 的 ref-token）出
 * canonical mention，其余出原始文本。见 ComposerEditor.textWithMentions。
 */
function readMentionText(editor: LexicalEditor): string {
  let out = ''
  editor.getEditorState().read(() => {
    const parts: string[] = []
    for (const block of $getRoot().getChildren()) {
      if (!(block instanceof ElementNode)) {
        parts.push(block.getTextContent())
        continue
      }
      let line = ''
      let hasRef = false
      for (const child of block.getChildren()) {
        if ($isRefChipNode(child)) {
          line += child.__ref
          hasRef = true
        } else if ($isRefTokenNode(child) && child.__mention) {
          line += child.__mention
          hasRef = true
        } else {
          line += child.getTextContent()
        }
      }
      parts.push(hasRef ? line : block.getTextContent())
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
  /**
   * 当前 live 的 skill/slash 命令名集合（宿主指令名录 + 客户端 /model）。每次文本
   * 节点变换时调用，`/command`（skill 形态）命中才着色——对齐官方 TEXT_REF_RE
   * 的 `[/@]` 触发符词库门控。缺省为空集（无候选名，/command 不着色）。
   */
  slashTokenNames?: () => ReadonlySet<string>
}): ComposerEditor {
  const { handlers, placeholderText, editable = true } = opts
  let bindings = opts.bindings ?? new Map<string, string>()
  const atTokenNames = opts.atTokenNames ?? ((): ReadonlySet<string> => EMPTY_NAME_SET)
  const slashTokenNames = opts.slashTokenNames ?? ((): ReadonlySet<string> => EMPTY_NAME_SET)

  const editor = createEditor({
    namespace: 'dsh-composer',
    nodes: [RefTokenNode, ReferenceChipNode],
    editable,
    onError: (err) => console.error('[composer editor]', err),
  })

  registerPlainText(editor)
  const historyState = createEmptyHistoryState()
  const unregisterHistory = registerHistory(editor, historyState, 1000)
  const unregisterTextRef = registerTextRefDecoration(editor, atTokenNames, slashTokenNames)

  const root = document.createElement('div')
  root.className = 'lexical-input'
  root.setAttribute('contenteditable', editable ? 'true' : 'false')
  root.setAttribute('role', 'textbox')
  root.setAttribute('aria-multiline', 'true')

  const placeholder = document.createElement('div')
  placeholder.className = 'lexical-placeholder'
  placeholder.textContent = placeholderText

  const getText = (): string => readPlainText(editor)
  const textWithMentions = (): string => readMentionText(editor)

  /** 草稿版本号（见 ComposerEditor.draftRev）：由更新监听在文本变化时 +1。 */
  let rev = 0

  /** 输入法组合期判定（对齐官方 registerComposerKeymap 的 isComposingEvent）。 */
  let composing = false
  let composingUntil = 0
  const onCompositionStart = (): void => {
    composing = true
  }
  const onCompositionEnd = (): void => {
    composing = false
    composingUntil = Date.now() + 10
  }
  const blockedByComposition = (event: KeyboardEvent | null): boolean =>
    event?.isComposing === true || event?.keyCode === 229 || composing || Date.now() < composingUntil

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

  const rescanTextRefs = (): void => {
    editor.update(() => {
      for (const node of $getRoot().getAllTextNodes()) node.markDirty()
    })
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
    // 分隔空格只在后一位不是空格时补（官方 insertReference 的 tail 判定）：
    // 否则「@ 引用后面已经有空格」被再补一次会出双空格。
    const pad = afterCaret().startsWith(' ') ? '' : ' '
    editor.update(() => {
      const sel = $getSelection()
      // 第 4 个参数是文本投影（clipboardText）：传 mention（可解析引用）而不是
      // display token——复制/落草稿/跨窗口/重启都靠它还原引用。
      const token = $createRefChipNode(appearance, mention, text, mention, appearance)
      if ($isRangeSelection(sel)) {
        sel.insertNodes([token])
        if (pad) sel.insertText(pad)
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

  const replaceRangeWithParts = (start: number, end: number, parts: Array<{ text: string; mention?: string }>): void => {
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      for (const part of parts) {
        if (part.mention) sel.insertNodes([$createRefTokenNode(part.text, part.mention)])
        else if (part.text) sel.insertText(part.text)
      }
    }, { discrete: true })
  }

  const replaceTokenRange = (start: number, end: number, text: string, mention: string, appearance: ChipAppearance = 'file'): void => {
    const pad = getText().slice(end, end + 1) === ' ' ? '' : ' '
    const { s, e } = resolveTextOffsets(start, end)
    editor.update(() => {
      const sel = $createRangeSelection()
      sel.anchor.set(s.key, s.offset, s.type)
      sel.focus.set(e.key, e.offset, e.type)
      $setSelection(sel)
      const token = $createRefChipNode(appearance, mention, text, mention, appearance)
      sel.insertNodes([token])
      if (pad) sel.insertText(pad)
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
          for (const seg of splitLineByReferences(line, bindings)) {
            if (!seg.text) continue
            if (seg.kind === 'chip') {
              const mention = seg.mention ?? seg.text
              const appearance = chipAppearanceForMention(mention)
              p.append($createRefChipNode(appearance, mention, seg.text, mention, appearance))
            } else if (seg.kind === 'token') {
              p.append($createRefTokenNode(seg.text, seg.mention))
            } else {
              p.append($createTextNode(seg.text))
            }
          }
          rootNode.append(p)
        }
        $getRoot().selectEnd()
      },
      // HISTORIC_TAG：程序化写入不进 undo 栈（registerHistory 对 historic 更新一律
      // 丢弃候选）。否则「发送后清空」会作为一条可撤销记录留在栈里，Cmd+Z 把已经
      // 发出去的内容复活回输入框。
      { tag: [SET_TAG, HISTORIC_TAG], discrete: true },
    )
    // 整体重写等于换了一条内容基线：把既有的 undo/redo 栈一起清掉。只靠上面的
    // historic 标签会让 historyState.current 停在重写前的状态，之后用户一打字
    // （新历史条目以旧状态为底）Cmd+Z 仍能撤回被程序化替换掉的旧内容。
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
  }

  // 挂载完成后再挂更新监听（见下方注释）：lastText 以「挂载后的当前文本」起步，
  // 而不是 null 哨兵——挂载后紧跟的无文本变化 update（focus(true) 的 selectEnd、
  // 装饰变换等）不该被当成「用户敲了内容」。哨兵写法会让新编辑器把第一次空更新
  // 报成一次空文本变化，外层据此作废清空暂存；清空带附件的内容会重建 composer，
  // 于是「清空后 Ctrl+Z 反悔」又被这次假变化清掉。
  let lastText: string = getText()
  let lastSel = { start: -1, end: -1 }

  // 键盘：Enter 发送 / ↑ 召回 / Esc 清空或停止 / ⌘Z 反悔。
  const unregisterKeys = mergeRegister(
    editor.registerCommand<KeyboardEvent | null>(
      KEY_ENTER_COMMAND,
      (event) => {
        // Shift+Enter 换行；组合期（isComposing / keyCode 229 / compositionend 后
        // 10ms）确认候选的 Enter：不发送，交回 registerPlainText。
        if (event?.shiftKey || blockedByComposition(event)) return false
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
        if (blockedByComposition(event)) return false
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
        if (blockedByComposition(event)) return false
        const consumed = handlers.onEscape()
        if (consumed) event?.preventDefault()
        return consumed
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand<void>(UNDO_COMMAND, () => handlers.onUndoRestore(), COMMAND_PRIORITY_HIGH),
  )

  // 撤销/反悔（B-06）：Lexical 只把**平台**撤销键派发成 UNDO_COMMAND
  // （macOS 只认 ⌘Z，Windows/Linux 只认 Ctrl+Z），所以「清空后按 Ctrl+Z 找回」
  // 这条写进文案、也照此验收的能力在 macOS 上按不出来。这里在捕获阶段自己收
  // 复合键：Ctrl+Z 与 ⌘Z 都算，有内容可反悔就消费（preventDefault +
  // stopPropagation，不让 Lexical/浏览器再走一遍）；没得反悔就放行，回落
  // Lexical 的平台撤销语义。
  const onUndoKey = (event: KeyboardEvent): void => {
    if (blockedByComposition(event)) return
    if (event.key.toLowerCase() !== 'z' || event.altKey || event.shiftKey) return
    if (!event.ctrlKey && !event.metaKey) return
    if (!handlers.onUndoRestore()) return
    event.preventDefault()
    event.stopPropagation()
  }
  root.addEventListener('keydown', onUndoKey, true)

  // paste：先给外层（sessions/图片/折叠）机会，未消费回落到 registerPlainText。
  const unregisterPaste = editor.registerCommand<PasteCommandType>(
    PASTE_COMMAND,
    (event) => handlers.onPaste(event as unknown as ClipboardEvent),
    COMMAND_PRIORITY_HIGH,
  )

  // copy：写「文本投影」而不是 DOM 文本。chip 的 DOM 里只有显示名（`@foo.ts`），
  // 原生复制会把它当纯文本复制出去，粘到别处/别的窗口就解析不出引用；文本投影
  // （getTextContent = canonical mention）才是可解析的。选区里没有 chip 时写回的
  // 内容与原生一致（同一个 getText 切片），不改变既有行为。
  const unregisterCopy = editor.registerCommand<ClipboardEvent | KeyboardEvent | null>(
    COPY_COMMAND,
    (event) => {
      const sel = selection()
      if (sel.start === sel.end) return false
      const clipboard = event as ClipboardEvent | null
      clipboard?.preventDefault()
      clipboard?.clipboardData?.setData('text/plain', getText().slice(sel.start, sel.end))
      return true
    },
    COMMAND_PRIORITY_HIGH,
  )

  // hover 联动。
  const onMouseMove = (e: MouseEvent): void => handlers.onTokenHover(mentionFromDom(e.target))
  const onMouseLeave = (): void => handlers.onTokenHover(null)
  root.addEventListener('mousemove', onMouseMove)
  root.addEventListener('mouseleave', onMouseLeave)

  // 组合期跟踪（对齐官方 registerComposerKeymap 的 registerRootListener）：
  // keydown 上的 isComposing 在 compositionend 同帧的 Enter 上已经翻假，
  // 靠 compositionend 后 10ms 的窗口兜住「确认候选」那一下。
  root.addEventListener('compositionstart', onCompositionStart)
  root.addEventListener('compositionend', onCompositionEnd)

  editor.setRootElement(root)

  // 挂载完成后再挂更新监听：首帧（setRootElement 内触发的 update）不让 onTextChange
  // 提前触发，后续文本/选区变化才通知外层。
  const unregisterUpdate = editor.registerUpdateListener(({ tags }) => {
    const text = getText()
    if (text !== lastText) {
      lastText = text
      rev += 1
      placeholder.style.display = text.length === 0 ? '' : 'none'
      handlers.onTextChange(text, { programmatic: tags.has(SET_TAG) })
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
    textWithMentions,
    setText,
    insertTextAtCaret,
    insertTokenAtCaret,
    replaceRange,
    replaceRangeWithParts,
    replaceTokenRange,
    selection,
    draftRev: () => rev,
    blockedByComposition,
    setSelection,
    beforeCaret,
    afterCaret,
    focus,
    rescanTextRefs,
    dispose: () => {
      editor.setRootElement(null)
      unregisterUpdate()
      unregisterKeys()
      unregisterPaste()
      unregisterCopy()
      unregisterHistory()
      unregisterTextRef()
      root.removeEventListener('mousemove', onMouseMove)
      root.removeEventListener('mouseleave', onMouseLeave)
      root.removeEventListener('keydown', onUndoKey, true)
      root.removeEventListener('compositionstart', onCompositionStart)
      root.removeEventListener('compositionend', onCompositionEnd)
    },
  }
}
