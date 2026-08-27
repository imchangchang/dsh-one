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
  ChatMessage,
  ChatState,
  ChatToolBlock,
  FromWebviewMessage,
  PendingApproval,
  PendingQuestion,
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
/** Half-answered pending questions: rpcId → question index → picked labels / typed text. */
const answerDrafts = new Map<string, Map<number, string | Set<string>>>()

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
  const msg = event.data as { type?: string; state?: ChatState }
  if (msg?.type === 'state' && msg.state) {
    state = msg.state
    render()
  }
})

function render(): void {
  const hadFocus = document.activeElement?.id === 'input'
  const draft = (document.getElementById('input') as HTMLTextAreaElement | null)?.value
  app.textContent = ''
  if (!state || !state.sessionId) {
    app.appendChild(renderEmpty())
    return
  }
  if (state.sessionTitle) app.appendChild(el('div', 'chat-header', state.sessionTitle))

  const messages = el('div', 'messages')
  messages.id = 'messages'
  for (const m of state.messages) messages.appendChild(renderMessage(m))
  if (state.messages.length === 0) {
    messages.appendChild(el('div', 'muted-hint', '会话还没有消息，在下方输入开始。'))
  }
  messages.addEventListener('scroll', () => {
    stickToBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 40
  })
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
    row.appendChild(el('div', 'bubble', m.text))
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
  const input = document.createElement('textarea')
  input.id = 'input'
  input.rows = 1
  input.placeholder = state?.canSend
    ? '输入消息，Enter 发送，Shift+Enter 换行'
    : '服务未就绪，暂时无法发送'
  input.disabled = !state?.canSend
  if (draft) input.value = draft

  const button = buttonEl('send-button', '')
  const updateButton = (): void => {
    if (state?.running) {
      button.textContent = '停止'
      button.disabled = false
    } else {
      button.textContent = '发送'
      button.disabled = !state?.canSend || input.value.trim().length === 0
    }
  }
  const sendCurrent = (): void => {
    if (!state || state.running || !state.canSend) return
    const text = input.value.trim()
    if (!text) return
    post({ type: 'send', text })
    input.value = ''
    autoGrow(input)
    updateButton()
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
  updateButton()
  wrap.appendChild(input)
  wrap.appendChild(button)
  return wrap
}

function autoGrow(input: HTMLTextAreaElement): void {
  input.style.height = 'auto'
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`
}
