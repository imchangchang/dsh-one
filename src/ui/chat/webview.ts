/**
 * Chat webview frontend: renders ChatState snapshots pushed by the host
 * (src/ui/chatView.ts) and posts user actions back (FromWebviewMessage).
 * Runs in the webview's browser context; esbuild bundles it (marked +
 * dompurify inlined) to dist/chatWebview.js. Rendering is a full rebuild per
 * snapshot — the host throttles pushes, so this stays cheap for a skeleton.
 */
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type {
  ChatBlock,
  ChatFile,
  ChatImage,
  ChatMessage,
  ChatState,
  ChatToolBlock,
  FromWebviewMessage,
  ModelCatalog,
  OutgoingImage,
  PendingApproval,
  PendingQuestion,
  StagedFile,
  ToWebviewMessage,
} from '../../pure/chatContract.ts'

interface VsCodeApi {
  postMessage(message: FromWebviewMessage): void
}
declare function acquireVsCodeApi(): VsCodeApi

const vscode = acquireVsCodeApi()
const app = document.getElementById('app') as HTMLElement

marked.setOptions({ gfm: true, breaks: true })

let state: ChatState | null = null
/** Auto-scroll only when the user is already near the bottom. */
let stickToBottom = true
/** Images staged in the composer, sent with the next `send`. */
let pendingImages: OutgoingImage[] = []
/** Non-image files staged as chips; their paths join the prompt text on send. */
let pendingFiles: StagedFile[] = []
/** Session the staged images belong to; a switch drops them. */
let stagedForSession: string | null = null
/** Latest model catalog reply; dropped on session switch, refetched on menu open. */
let modelCatalog: ModelCatalog | null = null
/** Attachment id → data URL, filled by attachmentData replies; lives for the webview's lifetime. */
const attachmentCache = new Map<string, string>()
/** Attachment ids already requested, so re-renders don't repost while a fetch is in flight. */
const attachmentRequested = new Set<string>()
/** Half-answered pending questions: rpcId → question index → picked labels / typed text. */
const answerDrafts = new Map<string, Map<number, string | Set<string>>>()

/** Static mirror of dsh's built-in slash commands (no list API as of rc.2). */
const SLASH_COMMANDS: Array<{ name: string; description: string }> = [
  { name: 'compact', description: '压缩较早的会话历史' },
  { name: 'export', description: '导出本会话日志（ZIP）' },
  { name: 'feedback', description: '记录本会话反馈' },
  { name: 'goal', description: '设置或查看长任务目标' },
  { name: 'permission', description: '切换权限预设' },
  { name: 'plan', description: '进入或退出计划模式' },
  { name: 'model', description: '选择本会话使用的模型' },
]

/** Shield glyphs copied verbatim from dsh-client-ui-conversation's PermissionSelect. */
const SHIELD_OUTLINE =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z'
const PERMISSION_GLYPHS: Record<string, string> = {
  'read-only': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor"/></svg>`,
  'workspace-write': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor"/><path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor"/><path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor"/><path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor"/><path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor"/></svg>`,
  'danger-full-access': `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="${SHIELD_OUTLINE}" stroke="currentColor" stroke-width="1.31831" stroke-linejoin="round"/><path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor"/><path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor"/></svg>`,
}

function post(message: FromWebviewMessage): void {
  vscode.postMessage(message)
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

function buttonEl(className: string | undefined, text: string): HTMLButtonElement {
  const b = document.createElement('button')
  if (className) b.className = className
  b.textContent = text
  return b
}

function md(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }))
}

window.addEventListener('message', (event) => {
  const msg = event.data as ToWebviewMessage
  if (msg?.type === 'state' && msg.state) {
    state = msg.state
    if (state.sessionId !== stagedForSession) {
      pendingImages = []
      pendingFiles = []
      modelCatalog = null
      stagedForSession = state.sessionId
    }
    render()
  } else if (msg?.type === 'imagesPicked' && Array.isArray(msg.images)) {
    pendingImages = [...pendingImages, ...msg.images]
    render()
  } else if (msg?.type === 'filesPicked' && Array.isArray(msg.files)) {
    pendingFiles = [...pendingFiles, ...msg.files]
    render()
  } else if (msg?.type === 'modelCatalog' && msg.catalog) {
    modelCatalog = msg.catalog
    if (modelMenuBody) renderModelMenuRoot(modelMenuBody, msg.catalog)
  } else if (msg?.type === 'attachmentData' && typeof msg.attachmentId === 'string') {
    const dataUrl = `data:${msg.mediaType};base64,${msg.data}`
    attachmentCache.set(msg.attachmentId, dataUrl)
    if (pendingPreview === msg.attachmentId) {
      pendingPreview = null
      openLightbox(dataUrl)
    }
    render()
  }
})

/** Open composer popover; attached to document.body so it survives render(). */
let popover: HTMLElement | null = null
/** Body of the open model menu awaiting the catalog reply. */
let modelMenuBody: HTMLElement | null = null

function onPopoverOutside(e: MouseEvent): void {
  if (popover && !popover.contains(e.target as Node)) closePopover()
}

function onPopoverKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') closePopover()
}

function closePopover(): void {
  popover?.remove()
  popover = null
  modelMenuBody = null
  document.removeEventListener('mousedown', onPopoverOutside, true)
  document.removeEventListener('keydown', onPopoverKey, true)
}

function showPopover(anchor: HTMLElement, body: HTMLElement): void {
  closePopover()
  const p = el('div', 'popover')
  p.appendChild(body)
  document.body.appendChild(p)
  const rect = anchor.getBoundingClientRect()
  p.style.left = `${Math.max(4, rect.left)}px`
  p.style.bottom = `${window.innerHeight - rect.top + 6}px`
  popover = p
  document.addEventListener('mousedown', onPopoverOutside, true)
  document.addEventListener('keydown', onPopoverKey, true)
}

function menuItem(
  label: string,
  opts: { right?: string; checked?: boolean; glyph?: string; onClick: () => void },
): HTMLElement {
  const item = el('div', opts.checked ? 'menu-item checked' : 'menu-item')
  item.appendChild(el('span', 'check', '✓'))
  if (opts.glyph) {
    const g = el('span', 'glyph')
    g.innerHTML = opts.glyph // build-time constant strings, not user input
    item.appendChild(g)
  }
  item.appendChild(el('span', undefined, label))
  if (opts.right) item.appendChild(el('span', 'menu-right', opts.right))
  item.addEventListener('click', opts.onClick)
  return item
}

function openPermissionMenu(anchor: HTMLElement): void {
  const perms = state?.permissions
  if (!perms) return
  const body = el('div')
  for (const o of perms.options) {
    body.appendChild(
      menuItem(o.label, {
        glyph: PERMISSION_GLYPHS[o.value],
        checked: o.value === perms.current,
        onClick: () => {
          closePopover()
          if (o.value !== perms.current) post({ type: 'setPermission', value: o.value })
        },
      }),
    )
  }
  showPopover(anchor, body)
}

function openModelMenu(anchor: HTMLElement): void {
  const body = el('div')
  showPopover(anchor, body)
  modelMenuBody = body
  if (modelCatalog) {
    renderModelMenuRoot(body, modelCatalog)
  } else {
    body.appendChild(el('div', 'menu-hint', '加载中…'))
  }
  // Always refetch so the menu reflects the server's current selection.
  post({ type: 'requestModels' })
}

function renderModelMenuRoot(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  body.appendChild(
    menuItem('模型', {
      right: `${model?.name ?? catalog.current.model} ›`,
      onClick: () => renderModelMenuModels(body, catalog),
    }),
  )
  const efforts = model?.efforts ?? []
  if (efforts.length > 0) {
    const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
    const effort = efforts.find((e) => e.id === effortId)
    body.appendChild(
      menuItem('推理等级', {
        right: `${effort?.name ?? effortId ?? '默认'} ›`,
        onClick: () => renderModelMenuEfforts(body, catalog),
      }),
    )
  }
}

function renderModelMenuModels(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem('‹ 返回', { onClick: () => renderModelMenuRoot(body, catalog) }))
  for (const g of catalog.groups) {
    body.appendChild(el('div', 'menu-group', g.name))
    for (const m of g.models) {
      const isCurrent = catalog.current.provider === g.id && catalog.current.model === m.id
      body.appendChild(
        menuItem(m.name, {
          checked: isCurrent,
          onClick: () => {
            closePopover()
            if (isCurrent) return
            // Keep the current effort only when the new model supports it.
            const keep = m.efforts.some((e) => e.id === catalog.current.reasoningEffort)
            post({
              type: 'setModel',
              provider: g.id,
              model: m.id,
              reasoningEffort: keep ? catalog.current.reasoningEffort : undefined,
            })
          },
        }),
      )
    }
  }
}

function renderModelMenuEfforts(body: HTMLElement, catalog: ModelCatalog): void {
  body.textContent = ''
  body.appendChild(menuItem('‹ 返回', { onClick: () => renderModelMenuRoot(body, catalog) }))
  const model = catalog.groups
    .find((g) => g.id === catalog.current.provider)
    ?.models.find((m) => m.id === catalog.current.model)
  const effortId = catalog.current.reasoningEffort ?? model?.defaultEffort
  for (const e of model?.efforts ?? []) {
    body.appendChild(
      menuItem(e.name, {
        right: e.description,
        checked: e.id === effortId,
        onClick: () => {
          closePopover()
          if (e.id !== catalog.current.reasoningEffort) {
            post({
              type: 'setModel',
              provider: catalog.current.provider,
              model: catalog.current.model,
              reasoningEffort: e.id,
            })
          }
        },
      }),
    )
  }
}

function openCommandMenu(anchor: HTMLElement): void {
  const body = el('div')
  for (const c of SLASH_COMMANDS) {
    body.appendChild(
      menuItem(`/${c.name}`, {
        right: c.description,
        onClick: () => {
          if (c.name === 'model') {
            openModelMenu(anchor)
            return
          }
          if (c.name === 'permission') {
            openPermissionMenu(anchor)
            return
          }
          closePopover()
          insertSlashCommand(c.name)
        },
      }),
    )
  }
  showPopover(anchor, body)
}

function insertSlashCommand(name: string): void {
  const input = document.getElementById('input') as HTMLTextAreaElement | null
  if (!input || input.disabled) return
  // Slash commands must lead the prompt; prepend ahead of any draft (its args).
  input.value = `/${name} ` + input.value
  autoGrow(input)
  input.focus()
  input.setSelectionRange(input.value.length, input.value.length)
  const send = document.querySelector<HTMLButtonElement>('.send-button')
  if (send && state?.canSend && !state.running) send.disabled = false
}

/** Inline rename: swap the header title for an input; Enter commits, Esc/blur cancels. */
function startInlineRename(header: HTMLElement): void {
  const titleEl = header.querySelector('.chat-title')
  if (!titleEl || !state?.sessionId) return
  const original = state.sessionTitle ?? ''
  const input = document.createElement('input')
  input.className = 'rename-input'
  input.value = original
  titleEl.replaceWith(input)
  header.querySelector('.rename-session')?.remove()
  input.focus()
  input.select()
  let settled = false
  const cancel = (): void => {
    if (settled) return
    settled = true
    render()
  }
  input.addEventListener('keydown', (e) => {
    // isComposing: Enter confirms an IME candidate, not the rename.
    if (e.key === 'Enter' && !e.isComposing) {
      const title = input.value.trim()
      if (title && title !== original) post({ type: 'renameSession', title })
      cancel()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  })
  input.addEventListener('blur', cancel)
}

function render(): void {
  // Menus are transient and anchored to composer elements that are rebuilt here.
  closePopover()
  const hadFocus = document.activeElement?.id === 'input'
  const draft = (document.getElementById('input') as HTMLTextAreaElement | null)?.value
  // The rebuild wipes scroll state; remember it so a user reading history
  // mid-stream is not thrown back to the top.
  const prevScrollTop = document.getElementById('messages')?.scrollTop ?? null
  app.textContent = ''
  if (!state || !state.sessionId) {
    app.appendChild(renderEmpty())
    return
  }
  if (state.sessionTitle) {
    const header = el('div', 'chat-header')
    header.appendChild(el('span', 'chat-title', state.sessionTitle))
    const rename = buttonEl('rename-session', '✎')
    rename.title = '重命名会话'
    rename.addEventListener('click', () => startInlineRename(header))
    header.appendChild(rename)
    app.appendChild(header)
  }

  const messages = el('div', 'messages')
  messages.id = 'messages'
  for (const m of state.messages) messages.appendChild(renderMessage(m))
  if (state.messages.length === 0) {
    messages.appendChild(el('div', 'muted-hint', '会话还没有消息，在下方输入开始。'))
  }
  messages.addEventListener('scroll', () => {
    stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40
    const jump = messages.querySelector<HTMLElement>('.jump-latest')
    if (jump) jump.style.display = stickToBottom ? 'none' : ''
  })
  // "Back to latest" floater: sticky at the scroller's bottom while the user
  // reads history; hidden while pinned to the tail.
  const jump = buttonEl('jump-latest', '↓ 回到最新')
  jump.style.display = stickToBottom ? 'none' : ''
  jump.addEventListener('click', () => {
    stickToBottom = true
    messages.scrollTop = messages.scrollHeight
    jump.style.display = 'none'
  })
  messages.appendChild(jump)
  app.appendChild(messages)

  if (state.pending.length > 0) {
    const pending = el('div', 'pending')
    for (const p of state.pending) {
      pending.appendChild(p.kind === 'approval' ? renderApproval(p) : renderQuestion(p))
    }
    app.appendChild(pending)
  }

  app.appendChild(renderInput(draft))
  if (stickToBottom) messages.scrollTop = messages.scrollHeight
  else if (prevScrollTop !== null) messages.scrollTop = prevScrollTop
  const input = document.getElementById('input') as HTMLTextAreaElement
  autoGrow(input)
  if (hadFocus) input.focus()
}

function renderEmpty(): HTMLElement {
  const wrap = el('div', 'empty')
  wrap.appendChild(el('div', 'empty-title', 'dsh 聊天'))
  wrap.appendChild(
    el('div', 'empty-hint', '在 Sessions 视图中点击一个会话开始聊天。若列表为空，请先启动 dsh 服务。'),
  )
  return wrap
}

function contextLabel(kind: string): string {
  if (kind === 'agent-instructions' || kind === 'legacy-instructions') return '工作区指令'
  if (kind === 'plugin') return '运行时上下文'
  return '上下文注入'
}

/** Attachment id whose bytes are being fetched to open a preview on arrival. */
let pendingPreview: string | null = null

/** Compact chip for one attached image; click fetches bytes (once) and previews. */
function imageChip(image: ChatImage): HTMLElement {
  const chip = el('span', 'image-chip msg-image-chip')
  chip.appendChild(el('span', 'chip-name', image.name ?? '图片'))
  chip.title = '点击预览'
  chip.addEventListener('click', () => {
    const dataUrl = attachmentCache.get(image.attachmentId)
    if (dataUrl) {
      openLightbox(dataUrl)
      return
    }
    pendingPreview = image.attachmentId
    if (!attachmentRequested.has(image.attachmentId)) {
      attachmentRequested.add(image.attachmentId)
      post({ type: 'requestAttachment', attachmentId: image.attachmentId })
    }
  })
  return chip
}

/** Compact chip for one attached file; the path is the payload, no preview. */
function fileChip(file: ChatFile): HTMLElement {
  const chip = el('span', 'image-chip')
  const name = el('span', 'chip-name', file.name)
  name.title = file.path
  chip.appendChild(name)
  return chip
}

/** Full-screen preview overlay for one image; click or Escape closes. */
function openLightbox(dataUrl: string): void {
  const overlay = el('div', 'lightbox')
  const img = document.createElement('img')
  img.src = dataUrl
  overlay.appendChild(img)
  const close = (): void => {
    overlay.remove()
    document.removeEventListener('keydown', onKey, true)
  }
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey, true)
  document.body.appendChild(overlay)
}

function renderMessage(m: ChatMessage): HTMLElement {
  if (m.kind === 'user') {
    // Host-injected context renders collapsed; only real human input bubbles.
    if (m.context) {
      const det = el('details', 'msg context')
      det.appendChild(el('summary', '', `📎 ${contextLabel(m.context)}（已随消息注入）`))
      det.appendChild(el('div', 'context-body', m.text))
      return det
    }
    const row = el('div', 'msg user')
    if (m.text) row.appendChild(el('div', 'bubble', m.text))
    const attachments = el('div', 'msg-images')
    if (m.images) for (const image of m.images) attachments.appendChild(imageChip(image))
    if (m.files) for (const file of m.files) attachments.appendChild(fileChip(file))
    if (attachments.childElementCount > 0) row.appendChild(attachments)
    return row
  }
  const row = el('div', 'msg assistant')
  for (const block of m.blocks) row.appendChild(renderBlock(block))
  if (!m.complete) row.appendChild(el('div', 'streaming', '▍'))
  if (m.interrupted) row.appendChild(el('div', 'interrupted', '已中断'))
  return row
}

function renderBlock(block: ChatBlock): HTMLElement {
  switch (block.type) {
    case 'text': {
      const div = el('div', 'md')
      div.innerHTML = md(block.text)
      return div
    }
    case 'reasoning': {
      const det = el('details', 'reasoning')
      det.appendChild(el('summary', '', '思考过程'))
      det.appendChild(el('div', 'reasoning-body', block.text))
      return det
    }
    case 'tool':
      return renderTool(block)
  }
}

function renderTool(block: ChatToolBlock): HTMLElement {
  const card = el('div', `tool tool-${block.status}`)
  const head = el('div', 'tool-head')
  if (block.status === 'running') {
    head.appendChild(el('span', 'spinner'))
  } else {
    head.appendChild(
      el('span', block.status === 'done' ? 'tool-status-done' : 'tool-status-error',
        block.status === 'done' ? '✓' : '✕'),
    )
  }
  head.appendChild(el('span', 'tool-name', block.name))
  if (block.title) head.appendChild(el('span', 'tool-title', block.title))
  card.appendChild(head)
  if (block.detail) card.appendChild(el('div', 'tool-detail', block.detail))
  if (block.diff) card.appendChild(renderDiff(block.diff))
  if (block.output) {
    const det = el('details', 'tool-output')
    det.appendChild(el('summary', '', '输出'))
    det.appendChild(el('pre', '', block.output))
    card.appendChild(det)
  }
  return card
}

function renderDiff(diff: { oldText: string; newText: string }): HTMLElement {
  const box = el('div', 'diff')
  for (const line of diff.oldText.split('\n')) box.appendChild(el('div', 'diff-line del', line))
  for (const line of diff.newText.split('\n')) box.appendChild(el('div', 'diff-line add', line))
  return box
}

function renderApproval(p: PendingApproval): HTMLElement {
  const card = el('div', 'pending-card')
  card.appendChild(el('div', 'pending-title', `权限请求：${p.toolName}`))
  if (p.reason) card.appendChild(el('div', 'pending-reason', p.reason))
  const actions = el('div', 'pending-actions')
  const allow = buttonEl('', '允许一次')
  const deny = buttonEl('secondary', '拒绝')
  // Disable both on click so a slow host can't be answered twice.
  allow.addEventListener('click', () => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome: 'allowed-once' })
  })
  deny.addEventListener('click', () => {
    allow.disabled = true
    deny.disabled = true
    post({ type: 'approval', rpcId: p.rpcId, outcome: 'rejected' })
  })
  actions.appendChild(allow)
  actions.appendChild(deny)
  card.appendChild(actions)
  return card
}

function questionDraft(rpcId: string): Map<number, string | Set<string>> {
  let d = answerDrafts.get(rpcId)
  if (!d) {
    d = new Map()
    answerDrafts.set(rpcId, d)
  }
  return d
}

function submitAnswer(p: PendingQuestion): void {
  const d = answerDrafts.get(p.rpcId)
  const parts = p.questions.map((_, i) => {
    const v = d?.get(i)
    if (v instanceof Set) return [...v].join('、')
    return v ?? ''
  })
  answerDrafts.delete(p.rpcId)
  post({ type: 'answer', rpcId: p.rpcId, answer: parts.join('\n') })
}

function renderQuestion(p: PendingQuestion): HTMLElement {
  const card = el('div', 'pending-card')
  const single = p.questions.length === 1
  p.questions.forEach((q, i) => {
    const wrap = el('div', 'question')
    if (q.header) wrap.appendChild(el('div', 'question-header', q.header))
    wrap.appendChild(el('div', 'question-text', q.question))
    const draft = questionDraft(p.rpcId)
    if (q.options && q.options.length > 0) {
      if (q.multiSelect) {
        const picked = (draft.get(i) as Set<string> | undefined) ?? new Set<string>()
        draft.set(i, picked)
        for (const opt of q.options) {
          const label = el('label', 'checkbox')
          const box = document.createElement('input')
          box.type = 'checkbox'
          box.checked = picked.has(opt.label)
          box.addEventListener('change', () => {
            if (box.checked) picked.add(opt.label)
            else picked.delete(opt.label)
          })
          label.appendChild(box)
          label.appendChild(el('span', '', opt.description ? `${opt.label} — ${opt.description}` : opt.label))
          wrap.appendChild(label)
        }
      } else {
        const group = el('div', 'question-options')
        for (const opt of q.options) {
          const btn = buttonEl('secondary option-btn', opt.label)
          if (opt.description) btn.title = opt.description
          if (draft.get(i) === opt.label) btn.classList.add('selected')
          btn.addEventListener('click', () => {
            draft.set(i, opt.label)
            // A lone single-select question answers immediately, Claude Code style.
            if (single) submitAnswer(p)
            else render()
          })
          group.appendChild(btn)
        }
        wrap.appendChild(group)
      }
    } else {
      const input = document.createElement('input')
      input.type = 'text'
      input.value = (draft.get(i) as string | undefined) ?? ''
      input.addEventListener('input', () => draft.set(i, input.value))
      wrap.appendChild(input)
    }
    card.appendChild(wrap)
  })
  // Multi-question / multi-select / text answers need an explicit confirm.
  const needsConfirm =
    !single || p.questions.some((q) => q.multiSelect || !q.options || q.options.length === 0)
  if (needsConfirm) {
    const actions = el('div', 'pending-actions')
    const ok = buttonEl('', '确认')
    ok.addEventListener('click', () => {
      ok.disabled = true
      submitAnswer(p)
    })
    actions.appendChild(ok)
    card.appendChild(actions)
  }
  return card
}

function renderInput(draft: string | undefined): HTMLElement {
  const wrap = el('div', 'input-area')
  const canSend = !!state?.canSend

  if (pendingImages.length > 0 || pendingFiles.length > 0) {
    const chips = el('div', 'image-chips')
    pendingImages.forEach((img, i) => {
      const chip = el('span', 'image-chip')
      const name = el('span', 'chip-name', img.name ?? '图片')
      name.style.cursor = 'zoom-in'
      name.title = '点击预览'
      name.addEventListener('click', () => {
        openLightbox(`data:${img.mediaType || 'image/png'};base64,${img.data}`)
      })
      chip.appendChild(name)
      const remove = buttonEl('chip-remove', '×')
      remove.title = '移除图片'
      remove.addEventListener('click', () => {
        pendingImages.splice(i, 1)
        render()
      })
      chip.appendChild(remove)
      chips.appendChild(chip)
    })
    pendingFiles.forEach((file, i) => {
      const chip = el('span', 'image-chip')
      const name = el('span', 'chip-name', file.name)
      name.title = file.path
      chip.appendChild(name)
      const remove = buttonEl('chip-remove', '×')
      remove.title = '移除文件'
      remove.addEventListener('click', () => {
        pendingFiles.splice(i, 1)
        render()
      })
      chip.appendChild(remove)
      chips.appendChild(chip)
    })
    wrap.appendChild(chips)
  }

  const row = el('div', 'input-row')
  const input = document.createElement('textarea')
  input.id = 'input'
  input.rows = 1
  input.placeholder = canSend
    ? '输入消息，Enter 发送，Shift+Enter 换行，可粘贴图片/文件'
    : '服务未就绪，暂时无法发送'
  input.disabled = !canSend
  if (draft) input.value = draft

  const button = buttonEl('send-button', '')
  const updateButton = (): void => {
    if (state?.running) {
      button.textContent = '停止'
      button.disabled = false
    } else {
      button.textContent = '发送'
      button.disabled =
        !canSend || (input.value.trim().length === 0 && pendingImages.length === 0 && pendingFiles.length === 0)
    }
  }
  const sendCurrent = (): void => {
    if (!state || state.running || !state.canSend) return
    // Staged file chips travel as <attachment> path lines appended to the
    // prompt text (dsh has no file content part); the folder parses them
    // back into chips for history rendering.
    const text = [input.value.trim(), ...pendingFiles.map((f) => `<attachment>${f.path}</attachment>`)]
      .filter(Boolean)
      .join('\n')
    if (!text && pendingImages.length === 0) return
    const images = pendingImages
    pendingImages = []
    pendingFiles = []
    post({ type: 'send', text, ...(images.length > 0 ? { images } : {}) })
    input.value = ''
    render()
  }
  button.addEventListener('click', () => {
    if (state?.running) post({ type: 'stop' })
    else sendCurrent()
  })
  input.addEventListener('keydown', (e) => {
    // isComposing: don't send while an IME candidate window is open.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      sendCurrent()
    }
  })
  input.addEventListener('input', () => {
    autoGrow(input)
    updateButton()
  })
  input.addEventListener('paste', (e) => {
    // Every clipboard file becomes an attachment, images or not — the host
    // sniffs the bytes, so a missing declared type (macOS file promises) is fine.
    const items = Array.from(e.clipboardData?.items ?? []).filter((item) => item.kind === 'file')
    if (items.length === 0) return
    e.preventDefault()
    void (async () => {
      const files: OutgoingImage[] = []
      for (const [i, item] of items.entries()) {
        const file = item.getAsFile()
        if (!file) continue
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          })
          const comma = dataUrl.indexOf(',')
          files.push({
            mediaType: file.type || item.type,
            data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
            name: file.name || `pasted-${Date.now()}-${i + 1}`,
          })
        } catch {
          // Unreadable clipboard item: skip it, keep the rest.
        }
      }
      if (files.length > 0) post({ type: 'filesPasted', files })
    })()
  })
  updateButton()
  row.appendChild(input)
  row.appendChild(button)
  wrap.appendChild(row)

  const footer = el('div', 'input-footer')
  const addImage = buttonEl('pill', '+')
  addImage.title = '添加附件（图片或文件）'
  addImage.disabled = !canSend
  addImage.addEventListener('click', () => post({ type: 'pickFiles' }))
  footer.appendChild(addImage)
  const commands = buttonEl('pill', '/')
  commands.title = '命令'
  commands.disabled = !canSend
  commands.addEventListener('click', () => openCommandMenu(commands))
  footer.appendChild(commands)
  if (state?.permissions) {
    const perms = state.permissions
    const current = perms.options.find((o) => o.value === perms.current)
    const perm = buttonEl('pill', '')
    const glyph = current ? PERMISSION_GLYPHS[current.value] : undefined
    if (glyph) {
      const g = el('span', 'glyph')
      g.innerHTML = glyph // build-time constant, not user input
      perm.appendChild(g)
    }
    perm.appendChild(el('span', undefined, current?.label ?? perms.current))
    perm.title = '权限模式'
    perm.disabled = !canSend
    perm.addEventListener('click', () => openPermissionMenu(perm))
    footer.appendChild(perm)
  }
  const model = buttonEl('pill', state?.modelLabel ?? '选择模型')
  model.title = '模型'
  model.disabled = !canSend
  model.addEventListener('click', () => openModelMenu(model))
  footer.appendChild(model)
  wrap.appendChild(footer)

  if (state?.statsLine) wrap.appendChild(el('div', 'input-stats', state.statsLine))
  return wrap
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`
}
