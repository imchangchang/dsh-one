/**
 * Chat webview 的 slash 补全 / @ 提及补全系统（拆分自 webview.ts）：
 * composer 的 `/命令` 补全弹层、`@文件` / `@会话` 候选（host fileReferences/
 * list 异步）、会话 mention 粘贴接管。状态（slashPopupEl、slashRows、
 * slashIndex、fileRef 系列、mentionBindings）自包含在本模块。
 *
 * 拆分动机（multi-tab 重构第二层）：webview.ts 原本 3695+ 行单文件，任何
 * 前端新功能（渲染块、弹层、补全）都往里面塞。按域拆出后，新功能落在
 * 对应域文件，不再堆进入口文件。
 */
import { looksLikeSlashCommand } from '../../pure/slashCommand.ts'
import {
  SESSION_REFERENCE_SCHEME,
  formatSessionMention,
  mentionDisplayToken,
  splitSessionMentions,
} from '../../pure/sessionMention.ts'
import { activeAtToken, formatFileMention, type ActiveAtToken, type FileRefCandidate } from '../../pure/fileReference.ts'
import { el, post } from './webviewKit.ts'
import { sessionsSnapshot, state, type SlashRow } from './webviewState.ts'

/**
 * Static mirror of dsh's built-in slash commands (the host's commands/list RPC
 * serves the same six; `model` below is our own submenu entry — the host has
 * no /model command). Commands execute via commands/execute, not session.prompt.
 * `hint` mirrors the host's input hint and drives the composer's arg hints.
 */
const SLASH_COMMANDS: Array<{ name: string; description: string; hint?: string }> = [
  { name: 'compact', description: '压缩较早的会话历史' },
  { name: 'export', description: '导出本会话日志（ZIP）' },
  { name: 'feedback', description: '记录本会话反馈', hint: '<text>' },
  { name: 'goal', description: '设置或查看长任务目标', hint: '[<objective>|clear|edit <objective>|pause|resume]' },
  { name: 'permission', description: '切换权限预设', hint: '<preset>' },
  { name: 'plan', description: '进入或退出计划模式', hint: '[off|message]' },
  { name: 'model', description: '选择本会话使用的模型' },
]
/** Commands the composer's slash completion offers; `/model` is client-side (the send path intercepts it and opens the model menu, like the official web client). */
const COMPLETABLE_COMMANDS = SLASH_COMMANDS

/** slash 命令表（menus 模块的命令菜单也用它）。 */
export { SLASH_COMMANDS }

let slashPopupEl: HTMLElement | null = null
let slashRows: SlashRow[] = []
let slashIndex = 0

/**
 * @ 文件候选的请求/响应状态：requestId 递增防乱序，key 是触发时的完整
 * token（`@sub/que`），响应只在 token 没变时上屏。host 端失败回空列表。
 */
let fileRefSeq = 0
let fileRefRequestKey = ''
let fileRefResult: { key: string; items: FileRefCandidate[] } | null = null

/**
 * 显示 token（`@标题`）→ canonical mention 的映射，发送时由
 * expandMentionBindings 展开（src/pure/sessionMention.ts）。@ 补全和
 * mention 粘贴都会登记。常驻不清理：token 指向的是固定会话，之后的
 * 消息里再写同一 token 也应展开成同一引用。
 */
export const mentionBindings = new Map<string, string>()

export function hideSlashPopup(): void {
  slashPopupEl?.remove()
  slashPopupEl = null
  slashRows = []
  slashIndex = 0
  // 下次再触发 @ 时重新取文件候选，避免上屏陈旧目录。
  fileRefResult = null
}

/** 补全弹窗当前是否打开（webview.ts render() 的存活检查用）。 */
export function isSlashPopupOpen(): boolean {
  return slashPopupEl !== null
}

/**
 * host 的 fileRefList 响应入口（webview.ts 消息处理调用）：requestId 不匹配
 * 当前在途请求（已过期/乱序）时丢弃；匹配则存结果并重算补全弹窗。
 */
export function applyFileRefResponse(requestId: number, items: FileRefCandidate[]): void {
  if (requestId !== fileRefSeq) return
  fileRefResult = { key: fileRefRequestKey, items }
  const input = document.getElementById('input') as HTMLTextAreaElement | null
  if (input) updateSlashPopup(input)
}

function positionSlashPopup(input: HTMLTextAreaElement): void {
  if (!slashPopupEl) return
  const rect = input.getBoundingClientRect()
  slashPopupEl.style.left = `${Math.max(4, rect.left)}px`
  slashPopupEl.style.width = `${rect.width}px`
  slashPopupEl.style.bottom = `${window.innerHeight - rect.top + 6}px`
}

/** 按输入框当前位置重新定位补全弹窗（webview.ts 保留 composer 时调用）。 */
export function reanchorSlashPopup(input: HTMLTextAreaElement): void {
  if (slashPopupEl && input) positionSlashPopup(input)
}

/** Recompute the rows from the current value; hide when nothing applies. */
export function updateSlashPopup(input: HTMLTextAreaElement): void {
  // 斜杠命令整行匹配优先；不匹配时退到光标处的 @ 补全（文件 + 会话）。
  slashRows = computeSlashRows(input)
  if (slashRows.length === 0) slashRows = computeRefRows(input)
  if (slashRows.length === 0) {
    hideSlashPopup()
    return
  }
  slashIndex = slashRows.findIndex((r) => r.apply !== undefined)
  if (!slashPopupEl) {
    slashPopupEl = el('div', 'popover slash-popup')
    document.body.appendChild(slashPopupEl)
  }
  slashPopupEl.textContent = ''
  slashRows.forEach((row, i) => {
    if (row.header) {
      // 每行恰好一个子元素，moveSlashSelection 按子下标对齐 slashRows。
      slashPopupEl?.appendChild(el('div', 'menu-group', row.label))
      return
    }
    const item = el('div', i === slashIndex ? 'menu-item selected' : 'menu-item')
    item.appendChild(el('span', undefined, row.label))
    if (row.right) item.appendChild(el('span', 'menu-right', row.right))
    if (row.apply) {
      // mousedown + preventDefault: completing must not blur the textarea.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault()
        row.apply?.(input)
      })
    } else {
      item.classList.add('hint-row')
    }
    slashPopupEl?.appendChild(item)
  })
  positionSlashPopup(input)
}

export function moveSlashSelection(dir: number): void {
  if (!slashPopupEl || slashRows.length === 0) return
  const selectable = slashRows.map((r, i) => (r.apply ? i : -1)).filter((i) => i >= 0)
  if (selectable.length === 0) return
  const at = selectable.indexOf(slashIndex)
  slashIndex = selectable[(at + dir + selectable.length) % selectable.length]
  // header 行也是子元素，按子下标（而非 .menu-item 过滤后的下标）对齐 slashRows。
  const children = Array.from(slashPopupEl.querySelectorAll(':scope > *'))
  children.forEach((item, i) => {
    item.classList.toggle('selected', i === slashIndex)
  })
  // 键盘翻动时让选中项滚进可视区（弹窗 overflow-y 是独立的滚动容器）。
  children[slashIndex]?.scrollIntoView({ block: 'nearest' })
}

/**
 * composer 键盘事件中 slash 补全相关键的统一入口（webview.ts 的 input
 * keydown 调用）：补全弹窗打开时消费 ArrowUp/Down、Tab、Enter（选中项
 * apply）、Escape（关闭）；返回 true 表示已消费。弹窗未开返回 false。
 */
export function handleSlashKey(e: KeyboardEvent, input: HTMLTextAreaElement): boolean {
  if (!slashPopupEl || e.isComposing) return false
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveSlashSelection(1)
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveSlashSelection(-1)
    return true
  }
  if (e.key === 'Tab') {
    e.preventDefault()
    slashRows[slashIndex]?.apply?.(input)
    return true
  }
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    hideSlashPopup()
    return true
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    const apply = slashRows[slashIndex]?.apply
    if (apply) {
      e.preventDefault()
      apply(input)
      return true
    }
    // Hint-only popup: Enter falls through and sends the line as-is.
  }
  return false
}

/** Rows for the current composer value: command names, preset args, or one hint row. */
function computeSlashRows(input: HTMLTextAreaElement): SlashRow[] {
  const value = input.value
  if (!looksLikeSlashCommand(value) || value.includes('\n')) return []
  /** Filling the value and dispatching `input` re-enters updateSlashPopup. */
  const complete = (text: string) => () => {
    input.value = text
    input.focus()
    input.setSelectionRange(text.length, text.length)
    input.dispatchEvent(new Event('input'))
  }
  const sp = value.indexOf(' ')
  if (sp === -1) {
    const filter = value.slice(1).toLowerCase()
    if (filter.includes(' ')) return []
    return COMPLETABLE_COMMANDS.filter((c) => c.name.startsWith(filter)).map((c) => ({
      label: `/${c.name}`,
      right: c.description,
      apply: complete(`/${c.name} `),
    }))
  }
  const name = value.slice(1, sp)
  const argPrefix = value.slice(sp + 1)
  if (name === 'permission') {
    const options = state?.permissions?.options ?? []
    return options
      .filter((o) => o.value !== argPrefix && (o.value.startsWith(argPrefix) || o.label.toLowerCase().includes(argPrefix.toLowerCase())))
      .map((o) => ({ label: o.label, right: o.value, apply: complete(`/permission ${o.value}`) }))
  }
  const cmd = COMPLETABLE_COMMANDS.find((c) => c.name === name)
  if (cmd?.hint) return [{ label: `参数：${cmd.hint}` }]
  return []
}

/**
 * @ 补全（对齐 dsh web）：光标前的 `@query`（或未闭合 `@"query`）触发，
 * 文件/文件夹候选在前（host fileReferences/list，异步返回），当前会话
 * 所属工作区的会话候选在后，两组各有小标题 + 分割线；引号 token 只出
 * 文件。引用其它会话主要靠会话面板的"复制引用"，这里只补本工作区的会话。
 */
function computeRefRows(input: HTMLTextAreaElement): SlashRow[] {
  if (input.selectionStart !== input.selectionEnd) return []
  const at = activeAtToken(input.value.slice(0, input.selectionStart))
  if (!at) return []
  // token 变了才发新请求；响应到达后由消息处理分支重算本函数上屏。
  if (fileRefResult?.key !== at.prefix) {
    fileRefSeq += 1
    fileRefRequestKey = at.prefix
    fileRefResult = null
    post({ type: 'fileRefList', requestId: fileRefSeq, query: at.query })
  }
  const files = fileRows(input, at)
  const sessions = at.quoted ? [] : sessionRows(input, at)
  return [
    ...(files.length > 0 ? [{ label: '文件', header: true } as SlashRow, ...files] : []),
    ...(sessions.length > 0 ? [{ label: '会话', header: true } as SlashRow, ...sessions] : []),
  ]
}

/** 文件/文件夹候选行；响应未到达或已过期时为空（会话行先顶着）。 */
function fileRows(input: HTMLTextAreaElement, at: ActiveAtToken): SlashRow[] {
  if (fileRefResult === null || fileRefResult.key !== at.prefix) return []
  const cursor = input.selectionStart
  const tokenStart = cursor - at.prefix.length
  return fileRefResult.items.flatMap((c) => {
    const mention = formatFileMention(c, at.quoted)
    if (mention === undefined) return [] // 编辑器语法无法安全表示的路径不出候选
    const directory = c.kind === 'directory'
    const name = c.path.slice(c.path.lastIndexOf('/') + 1)
    return [{
      label: `@${name}${directory ? '/' : ''}`,
      right: c.path,
      apply: () => {
        // 目录不补空格：token 保持活跃（@dir/ 或 @"dir/），弹窗继续出下一层。
        const tail = directory ? '' : ' '
        input.value = `${input.value.slice(0, tokenStart)}${mention}${tail}${input.value.slice(cursor)}`
        input.focus()
        const caret = tokenStart + mention.length + tail.length
        input.setSelectionRange(caret, caret)
        input.dispatchEvent(new Event('input'))
      },
    }]
  })
}

/**
 * 当前会话所属工作区的会话候选行（不含当前会话——引用自己没有意义）。
 * 注意不是 isCurrent 组：isCurrent 跟的是 VS Code 打开的文件夹，当前会话
 * 可能属于别的工作区。空会话不在任何组的可见列表里，退回 workspaceLabel
 * 匹配。选中后输入框只留 `@标题` 显示 token，canonical mention 记在
 * mentionBindings 里，发送时才展开（textarea 做不到官方 contenteditable
 * 的原子引用，这是拍板的 b) 路线）。
 */
function sessionRows(input: HTMLTextAreaElement, at: ActiveAtToken): SlashRow[] {
  const snap = sessionsSnapshot
  if (!snap) return []
  const query = at.query.toLowerCase()
  const tokenStart = input.selectionStart - at.prefix.length
  const cursor = input.selectionStart
  const own =
    snap.workspaces.find((w) => w.sessions.some((s) => s.sessionId === state?.sessionId)) ??
    snap.workspaces.find((w) => state?.workspaceLabel !== undefined && w.label === state.workspaceLabel)
  if (!own) return []
  return own.sessions
    .filter((s) => s.sessionId !== state?.sessionId)
    .filter((s) => s.label.toLowerCase().includes(query) || s.sessionId.toLowerCase().includes(query))
    .slice(0, 10)
    .map((s) => ({
      label: `@${s.label}`,
      right: own.label,
      apply: () => {
        const token = mentionDisplayToken(s.label, s.sessionId, mentionBindings)
        mentionBindings.set(token, formatSessionMention(s.label, s.sessionId))
        input.value = `${input.value.slice(0, tokenStart)}${token} ${input.value.slice(cursor)}`
        input.focus()
        const caret = tokenStart + token.length + 1
        input.setSelectionRange(caret, caret)
        input.dispatchEvent(new Event('input'))
      },
    }))
}

/**
 * 粘贴板文本含 canonical 会话 mention（"复制引用"的产物 `@[标题](dsh-session:...)`）
 * 时接管粘贴：mention 换成 @ 补全同款的显示 token 并登记 mentionBindings
 * （发送时才展开）；光标前正在输入的 @query 触发词一并吃掉，先打 @ 再粘贴
 * 不会变成 `@@标题`。末尾是 mention 时补一个空格，与接着输入的文字隔开。
 * 返回是否已处理；普通文本粘贴返回 false，走默认行为。
 */
export function pasteSessionMentions(input: HTMLTextAreaElement, e: ClipboardEvent): boolean {
  const pasted = e.clipboardData?.getData('text/plain')
  if (!pasted || !pasted.includes(SESSION_REFERENCE_SCHEME)) return false
  const segments = splitSessionMentions(pasted)
  if (!segments.some((seg) => typeof seg !== 'string')) return false
  e.preventDefault()
  const inserted = segments
    .map((seg) => {
      if (typeof seg === 'string') return seg
      const token = mentionDisplayToken(seg.label, seg.sessionId, mentionBindings)
      mentionBindings.set(token, formatSessionMention(seg.label, seg.sessionId))
      return token
    })
    .join('')
  let before = input.value.slice(0, input.selectionStart)
  if (inserted.startsWith('@')) {
    const trigger = /(^|\s)@[^\s@]{0,30}$/.exec(before)
    if (trigger) before = before.slice(0, before.length - trigger[0].length) + trigger[1]
  }
  const after = input.value.slice(input.selectionEnd)
  const endsWithMention = typeof segments[segments.length - 1] !== 'string'
  const pad = endsWithMention && !/^\s/.test(after) ? ' ' : ''
  input.value = before + inserted + pad + after
  const caret = before.length + inserted.length + pad.length
  input.setSelectionRange(caret, caret)
  input.dispatchEvent(new Event('input'))
  return true
}
