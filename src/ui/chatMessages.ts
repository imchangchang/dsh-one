/**
 * Chat tab webview 消息处理（按域拆的 handler 集合）。ChatTabHost 收到本 tab
 * 的消息后按 type 分发给这里注册的 handler；每个 handler 内聚一个消息域
 * （全局动作 / 会话动作 / 后续移植 main 的 workspace、goal、文件域），新消息
 * 类型加到对应域即可，不再往 ChatViewProvider 的大 switch 里塞。
 */
import * as vscode from 'vscode'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  executeCommand,
  exportSessionLog,
  listFileReferences,
  renameSession,
  selectModel,
  sessionAttachment,
  sessionLogZipFilename,
  sessionModels,
} from '../server/dshRpc.ts'
import type { SessionModelSelection } from '../server/dshRpc.ts'
import type { FileRefCandidate } from '../pure/fileReference.ts'
import type { ChatState, FromWebviewMessage, OutgoingImage, ToWebviewMessage } from '../pure/chatContract.ts'
import { looksLikeSlashCommand } from '../pure/slashCommand.ts'
import type { ChatSessionController } from '../server/chatSession.ts'
import type { ChatTabHost } from './chatTab.ts'

export interface ChatTabMessageHandler {
  /** 本 handler 消费的消息类型（FromWebviewMessage 的 type 字面量）。 */
  readonly types: readonly string[]
  handle(host: ChatTabHost, m: FromWebviewMessage): Promise<void>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * 全局动作域：不依赖会话 controller 的消息（安装引导/外链/打开另一个会话）。
 * webview 重载的 ready 报到由 ChatTabHost 自己处理（需要推自己的 state）。
 */
const globalHandlers: ChatTabMessageHandler[] = [
  {
    types: ['openInstallPage'],
    async handle(_host, _m) {
      await vscode.commands.executeCommand('dshOne.openInstallPage')
    },
  },
  {
    types: ['openExternal'],
    async handle(host, m) {
      if (m.type !== 'openExternal' || typeof m.url !== 'string') return
      if (!/^(https?|mailto):/i.test(m.url)) return
      try {
        await vscode.env.openExternal(vscode.Uri.parse(m.url))
      } catch (err) {
        host.actions.logger.warn(`chat: openExternal(${m.url}) failed — ${errorText(err)}`)
      }
    },
  },
  {
    types: ['openInBuiltinBrowser'],
    async handle(_host, m) {
      if (m.type !== 'openInBuiltinBrowser' || typeof m.url !== 'string') return
      if (!/^(https?|mailto):/i.test(m.url)) return
      try {
        await vscode.commands.executeCommand('simpleBrowser.show', m.url)
      } catch {
        await vscode.env.openExternal(vscode.Uri.parse(m.url))
      }
    },
  },
  {
    types: ['sessionOpen'],
    async handle(host, m) {
      if (m.type !== 'sessionOpen' || typeof m.sessionId !== 'string') return
      // 子代理下拉名称 / 会话 @ 引用 chip 点击：打开（或聚焦）该会话的 tab。
      host.actions.openSession(m.sessionId)
    },
  },
]

/** 会话动作域：都落在本 tab 的 controller 上。 */
const chatHandlers: ChatTabMessageHandler[] = [
  {
    types: ['send'],
    async handle(host, m) {
      if (m.type !== 'send') return
      const controller = host.controller
      if (!controller) return
      const text = typeof m.text === 'string' ? m.text.trim() : ''
      const images = Array.isArray(m.images) ? m.images : []
      if (!text && images.length === 0) return
      // Slash commands route to runCommand; pasted absolute paths like
      // /Users/… are prompts for the model, not commands.
      if (looksLikeSlashCommand(text)) {
        await runCommand(host, text, images)
        return
      }
      await controller.send(text, images, m.steer === true)
    },
  },
  {
    types: ['stop'],
    async handle(host, m) {
      if (m.type !== 'stop') return
      const controller = host.controller
      if (!controller) return
      const restored = await controller.stop()
      if (restored.length > 0) {
        host.postMessage({ type: 'restoreDraft', text: restored.join('\n') })
      }
    },
  },
  {
    types: ['approval'],
    async handle(host, m) {
      if (m.type !== 'approval') return
      await host.controller?.respondApproval(m.rpcId, m.outcome)
    },
  },
  {
    types: ['answer'],
    async handle(host, m) {
      if (m.type !== 'answer') return
      await host.controller?.answerQuestion(m.rpcId, m.answers)
    },
  },
  {
    types: ['pickFiles'],
    async handle(host, _m) {
      await host.pickFiles()
    },
  },
  {
    types: ['filesPasted'],
    async handle(host, m) {
      if (m.type !== 'filesPasted') return
      await host.stagePastedFiles(Array.isArray(m.files) ? m.files : [])
    },
  },
  {
    types: ['requestModels'],
    async handle(host, _m) {
      await sendModelCatalog(host)
    },
  },
  {
    types: ['setModel'],
    async handle(host, m) {
      if (m.type !== 'setModel') return
      await applyModelSelection(host, {
        provider: m.provider,
        model: m.model,
        reasoningEffort: m.reasoningEffort,
      })
    },
  },
  {
    types: ['setPermission'],
    async handle(host, m) {
      if (m.type !== 'setPermission') return
      await setPermission(host, m.value)
    },
  },
  {
    types: ['setAgentPreset'],
    async handle(host, m) {
      if (m.type !== 'setAgentPreset') return
      // 失败（尤其 agent-preset-locked：会话已开跑）只记日志，不打扰用户。
      try {
        await host.controller?.setAgentPreset(m.id)
      } catch (err) {
        host.actions.logger.warn(`chat: setAgentPreset(${m.id}) failed — ${errorText(err)}`)
      }
    },
  },
  {
    types: ['renameSession'],
    async handle(host, m) {
      if (m.type !== 'renameSession') return
      await renameCurrentSession(host, m.title)
    },
  },
  {
    types: ['fileRefList'],
    async handle(host, m) {
      if (m.type !== 'fileRefList') return
      const controller = host.controller
      if (!controller) return
      // @ 补全候选：失败静默降级为空列表（对齐 web——这个领域失败只是
      // 少出候选，不弹错误打断输入）。
      let items: FileRefCandidate[] = []
      try {
        items = await listFileReferences(controller.url, controller.sessionId, m.query)
      } catch (err) {
        host.actions.logger.warn(
          `chat: fileRefList(${JSON.stringify(m.query)}) failed — ${errorText(err)}`,
        )
      }
      host.postMessage({ type: 'fileRefList', requestId: m.requestId, items })
    },
  },
  {
    types: ['queueEdit', 'queueSteer', 'queueRemove'],
    async handle(host, m) {
      const controller = host.controller
      if (!controller) return
      switch (m.type) {
        case 'queueEdit':
          await controller.editQueued(m.itemId, m.text)
          return
        case 'queueSteer':
          await controller.steerQueued(m.itemId)
          return
        case 'queueRemove':
          await controller.removeQueued(m.itemId)
          return
      }
    },
  },
  {
    types: ['requestAttachment'],
    async handle(host, m) {
      if (m.type !== 'requestAttachment') return
      await sendAttachment(host, m.attachmentId)
    },
  },
  {
    types: ['feedback'],
    async handle(host, m) {
      if (m.type !== 'feedback') return
      await host.controller?.rateMessage(m.messageId, m.rating)
    },
  },
  {
    types: ['fork'],
    async handle(host, m) {
      if (m.type !== 'fork') return
      const controller = host.controller
      if (!controller) return
      await forkAt(host, controller, m.atSeq)
    },
  },
  {
    types: ['loadEarlier'],
    async handle(host, _m) {
      await host.controller?.loadEarlier()
    },
  },
]

/** 全部 handler：ChatTabHost 按消息 type 分发。 */
export const chatMessageHandlers: ChatTabMessageHandler[] = [...globalHandlers, ...chatHandlers]

// ---- 会话动作的辅助实现（原 ChatViewProvider 的私有方法，按 tab 参数化） ----

/** Fetch the session's model catalog and push it to the tab's model menu. */
async function sendModelCatalog(host: ChatTabHost): Promise<void> {
  const controller = host.controller
  if (!controller) return
  try {
    const models = await sessionModels(controller.url, controller.sessionId)
    const message: ToWebviewMessage = {
      type: 'modelCatalog',
      catalog: {
        current: models.current,
        groups: models.groups.map((g) => ({
          id: g.id,
          name: g.name,
          models: g.models.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            efforts: m.reasoning?.efforts ?? [],
            defaultEffort: m.reasoning?.defaultEffort,
          })),
        })),
      },
    }
    host.postMessage(message)
  } catch (err) {
    const detail = errorText(err)
    host.actions.logger.warn(`chat: session.models failed — ${detail}`)
    vscode.window.showErrorMessage(`获取模型列表失败：${detail}`)
  }
}

/** Fetch one attachment's bytes and push them to the tab for inline rendering. */
async function sendAttachment(host: ChatTabHost, attachmentId: string): Promise<void> {
  const controller = host.controller
  if (typeof attachmentId !== 'string' || !attachmentId || !controller) return
  try {
    const { mediaType, data } = await sessionAttachment(controller.url, controller.sessionId, attachmentId)
    host.postMessage({ type: 'attachmentData', attachmentId, mediaType, data })
  } catch (err) {
    // Thumbnail stays a placeholder; not worth an error popup.
    host.actions.logger.warn(`chat: attachment ${attachmentId} fetch failed — ${errorText(err)}`)
  }
}

async function applyModelSelection(host: ChatTabHost, selection: SessionModelSelection): Promise<void> {
  const controller = host.controller
  if (!controller) return
  try {
    await selectModel(controller.url, controller.sessionId, selection)
    // 切模型后立即重算 contextBar 的窗口：用新模型窗口覆写 contextPressure，
    // 不等下一条消息（否则会停留在旧模型窗口直到发消息）。
    controller.applyModelSwitch(selection)
    await controller.refreshModels()
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(`切换模型失败：${detail}`)
  }
}

/**
 * Permission preset switch; rides the /permission slash command through the
 * dedicated command channel (session.prompt would not dispatch it). Mirrors
 * the web client: `danger-full-access` requires an explicit risk
 * confirmation first. The resulting permission/preset event refreshes the
 * footer pill through the permissions projection push.
 */
async function setPermission(host: ChatTabHost, value: string): Promise<void> {
  if (value === 'danger-full-access') {
    const confirm = await vscode.window.showWarningMessage(
      '确认启用 Full access？启用后 agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
      { modal: true },
      '启用 Full access',
    )
    if (!confirm) return
  }
  await runCommand(host, `/permission ${value}`)
}

/**
 * Execute one slash-command line. Matched commands need no local echo: the
 * host logs command/run before the handler and command/done after it, and
 * those events render as flow nodes in the message stream (same as the
 * official web client). Only an unmatched line — which logs nothing
 * host-side — gets a composer notice here.
 */
async function runCommand(host: ChatTabHost, line: string, images?: OutgoingImage[]): Promise<void> {
  const controller = host.controller
  if (!controller) return
  const outcome = await executeCommand(controller.url, controller.sessionId, line, images)
  if (!outcome.matched) {
    host.postMessage({ type: 'commandResult', text: `未知或格式错误的命令：${line}` })
    return
  }
  // `/export` only marks the request host-side ("Session log download
  // requested."); the bytes come from /api/session.export, which the
  // browser client hands to its download manager. Here we save via dialog.
  const name = line.trim().slice(1).split(/\s/, 1)[0]
  if (name === 'export' && outcome.kind === 'success') {
    await saveSessionLog(host, controller.url, controller.sessionId)
  }
}

/** Fetch the session-log ZIP and let the user pick where to save it. */
async function saveSessionLog(host: ChatTabHost, url: string, sessionId: string): Promise<void> {
  try {
    const zip = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在导出会话日志…' },
      () => exportSessionLog(url, sessionId),
    )
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(os.homedir(), 'Downloads', sessionLogZipFilename(sessionId))),
      filters: { ZIP: ['zip'] },
      saveLabel: '保存会话日志',
    })
    if (!target) return
    await fs.writeFile(target.fsPath, zip)
    void vscode.window.showInformationMessage(`会话日志已保存到 ${target.fsPath}`)
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(`导出会话日志失败：${detail}`)
  }
}

/** Fork the session at a completed turn, then open the child session in a new tab. */
async function forkAt(host: ChatTabHost, controller: ChatSessionController, atSeq: number): Promise<void> {
  try {
    const childId = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '正在创建分支会话…' },
      () => controller.fork(atSeq),
    )
    // The tree learns about the child via this hook; the chat opens a new
    // tab for it (用户决策：fork 后新开 tab，原会话 tab 保留便于对照).
    host.actions.onSessionsChanged()
    host.actions.openSessionInNewTab(childId)
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(`创建分支会话失败：${detail}`)
  }
}

/** Rename the attached session; the title projection push refreshes the header. */
async function renameCurrentSession(host: ChatTabHost, title: string): Promise<void> {
  const controller = host.controller
  const trimmed = title.trim()
  if (!controller || !trimmed) return
  try {
    await renameSession(controller.url, controller.sessionId, trimmed)
    host.actions.onSessionsChanged()
  } catch (err) {
    const detail = errorText(err)
    vscode.window.showErrorMessage(`重命名会话失败：${detail}`)
  }
}
